import { cloneJson, jsonValueIssue, type PropertyIssue } from './json-value.js';
import type { PropertyModel, PropertySourceGraph, SourceGraphNode } from './property-model.js';
import type { LogicalSourceGraph, LogicalSourceNode } from './logical-source-graph.js';
import { reachableSourceNodeIds, sourceGraphChildIds } from './source-graph-children.js';

export interface UnionAuthoringJudgment {
  sourceNodeId: string;
  editableNodeId: string;
  applicationNodeIds: string[];
  equivalentAlternatives?: Array<{ nodeId: string; editableNodeId: string }>;
  sourceUseRefs: string[];
  reason: string;
}

export interface SemanticCorrection {
  previousDecisionDigest: string;
  reason: string;
}

export function validateUnionAuthoring(input: unknown): PropertyIssue[] {
  const unsafe = jsonValueIssue(input);
  if (unsafe) return [unsafe];
  if (!Array.isArray(input) || !input.length)
    return [{ path: '/union_authoring', message: 'Union authoring requires a nonempty judgment array' }];
  const issues: PropertyIssue[] = [];
  const seen = new Set<string>();
  const names = (value: unknown, allowEmpty = false): value is string[] =>
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every((name) => typeof name === 'string' && name.trim()) &&
    new Set(value).size === value.length;
  for (const [index, value] of input.entries()) {
    const path = `/union_authoring/${index}`;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) =>
          ![
            'sourceNodeId',
            'editableNodeId',
            'applicationNodeIds',
            'equivalentAlternatives',
            'sourceUseRefs',
            'reason',
          ].includes(key),
      ) ||
      typeof value.sourceNodeId !== 'string' ||
      !value.sourceNodeId.trim() ||
      typeof value.editableNodeId !== 'string' ||
      !value.editableNodeId.trim() ||
      !names(
        value.applicationNodeIds,
        Array.isArray(value.equivalentAlternatives) && value.equivalentAlternatives.length > 0,
      ) ||
      !names(value.sourceUseRefs) ||
      typeof value.reason !== 'string' ||
      !value.reason.trim()
    ) {
      issues.push({ path, message: 'Invalid source-bound union-authoring judgment' });
      continue;
    }
    if (seen.has(value.sourceNodeId)) issues.push({ path, message: 'Duplicate union-authoring source node' });
    seen.add(value.sourceNodeId);
    if (value.equivalentAlternatives !== undefined) {
      const equivalents = value.equivalentAlternatives;
      if (
        !Array.isArray(equivalents) ||
        !equivalents.length ||
        equivalents.some((mapping: unknown) => {
          if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return true;
          const item = mapping as Record<string, unknown>;
          return (
            Object.keys(item).some((key) => !['nodeId', 'editableNodeId'].includes(key)) ||
            typeof item.nodeId !== 'string' ||
            !item.nodeId.trim() ||
            typeof item.editableNodeId !== 'string' ||
            !item.editableNodeId.trim()
          );
        }) ||
        new Set(equivalents.map((mapping) => mapping.nodeId)).size !== equivalents.length
      )
        issues.push({
          path: `${path}/equivalentAlternatives`,
          message: 'Scalar equivalence requires unique source alternatives and exact editable node identities',
        });
    }
  }
  return issues;
}

export function validateSemanticCorrection(input: unknown): PropertyIssue[] {
  const unsafe = jsonValueIssue(input);
  if (unsafe) return [unsafe];
  const value = input as Partial<SemanticCorrection> | null;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['previousDecisionDigest', 'reason'].includes(key)) ||
    typeof value?.previousDecisionDigest !== 'string' ||
    !value.previousDecisionDigest.trim() ||
    typeof value.reason !== 'string' ||
    !value.reason.trim()
  )
    return [
      {
        path: '/semantic_correction',
        message: 'A semantic correction requires the exact previous decision digest and a nonblank explanation',
      },
    ];
  return [];
}

export function validateUnionAuthoringSource(input: unknown, model: Pick<PropertyModel, 'source'>): PropertyIssue[] {
  const issues = validateUnionAuthoring(input);
  if (issues.length) return issues;
  const nodes = new Map(model.source.graph.nodes.map((node) => [node.id, node]));
  const uses = new Set(
    model.source.useEvidence?.filter((use) => use.status === 'output-flow-found').map((use) => use.reference),
  );
  const editableData = (id: string, active = new Set<string>()): boolean => {
    if (active.has(id)) return true;
    const node = nodes.get(id);
    if (!node) return false;
    if (['string', 'number', 'boolean', 'null', 'undefined', 'never'].includes(node.kind)) return true;
    const next = new Set(active).add(id);
    if (['reference', 'union', 'intersection'].includes(node.kind))
      return !!node.alternatives?.length && node.alternatives.every((child) => editableData(child, next));
    if (['array', 'tuple'].includes(node.kind))
      return (
        !!node.items &&
        (node.kind === 'tuple' || node.items.length > 0) &&
        node.items.every((child) => editableData(child, next))
      );
    return (
      node.kind === 'record' &&
      !!(node.fields?.length || node.indexSignatures?.length) &&
      !node.callSignatures?.length &&
      (node.fields ?? []).every((field) => editableData(field.nodeId, next)) &&
      (node.indexSignatures ?? []).every((index) => editableData(index.valueNodeId, next))
    );
  };
  for (const judgment of input as UnionAuthoringJudgment[]) {
    const node = nodes.get(judgment.sourceNodeId);
    const members = (node?.alternatives ?? []).filter(
      (id) => !['null', 'undefined', 'never'].includes(nodes.get(id)?.kind ?? ''),
    );
    const equivalents = judgment.equivalentAlternatives ?? [];
    const selected = new Set([judgment.editableNodeId, ...equivalents.map((mapping) => mapping.editableNodeId)]);
    const accounted = [...selected, ...judgment.applicationNodeIds, ...equivalents.map((mapping) => mapping.nodeId)];
    if (
      node?.kind !== 'union' ||
      node.coverage !== 'complete-within-declared-bound' ||
      !members.includes(judgment.editableNodeId) ||
      accounted.length !== members.length ||
      new Set(accounted).size !== accounted.length ||
      accounted.some((id) => !members.includes(id))
    )
      issues.push({
        path: '/union_authoring',
        message: 'Authoring judgment must account for the exact current union alternatives',
      });
    if (judgment.sourceUseRefs.some((reference) => !uses.has(reference)))
      issues.push({
        path: '/union_authoring/sourceUseRefs',
        message: 'Authoring selection requires current positive consumer evidence',
      });
    if (judgment.applicationNodeIds.some((id) => editableData(id)))
      issues.push({
        path: '/union_authoring/applicationNodeIds',
        message: 'Editable data alternatives cannot be discarded as application values',
      });
    for (const mapping of equivalents) {
      const alternate = nodes.get(mapping.nodeId);
      const editable = nodes.get(mapping.editableNodeId);
      const completeFiniteScalar = (candidate: SourceGraphNode | undefined, kind: string) =>
        candidate?.kind === kind &&
        candidate.coverage === 'complete-within-declared-bound' &&
        candidate.domain.openness === 'closed' &&
        candidate.domain.declaredValues.length === 1;
      if (
        !completeFiniteScalar(alternate, 'string') ||
        !completeFiniteScalar(editable, 'boolean') ||
        typeof editable?.domain.declaredValues[0] !== 'boolean' ||
        alternate?.domain.declaredValues[0] !== String(editable?.domain.declaredValues[0])
      )
        issues.push({
          path: '/union_authoring/equivalentAlternatives',
          message: 'Equivalent scalar alternatives require complete finite Boolean and matching literal text domains',
        });
    }
  }
  return issues;
}

function selectedGraph<T extends SourceGraphNode>(
  model: PropertyModel,
  graph: { rootId: string; nodes: T[] },
  sourceId: (node: T) => string,
) {
  const source = new Map(model.source.graph.nodes.map((node) => [node.id, node]));
  const nodes = graph.nodes.map((original) => {
    const node = cloneJson(original);
    const judgment =
      node.kind === 'union' ? model.unionAuthoring?.find((item) => item.sourceNodeId === sourceId(node)) : undefined;
    if (judgment) {
      const originalMembers = source.get(judgment.sourceNodeId)!.alternatives!;
      const omitted = new Set([
        ...judgment.applicationNodeIds,
        ...(judgment.equivalentAlternatives ?? []).map((mapping) => mapping.nodeId),
      ]);
      node.alternatives = node.alternatives!.filter((_id, index) => !omitted.has(originalMembers[index]!));
      const editable = source.get(judgment.editableNodeId)!;
      node.domain = cloneJson(editable.domain);
      if (judgment.equivalentAlternatives) {
        const selected = new Set([
          judgment.editableNodeId,
          ...judgment.equivalentAlternatives.map((mapping) => mapping.editableNodeId),
        ]);
        node.domain.declaredValues = [...selected].flatMap((id) => cloneJson(source.get(id)!.domain.declaredValues));
      }
      if ('unionBranches' in node) delete node.unionBranches;
    }
    return node;
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const reachable = reachableSourceNodeIds(graph.rootId, (id) => sourceGraphChildIds(byId.get(id)!));
  const retained = nodes.filter((node) => reachable.has(node.id));
  return {
    nodes: retained,
    coverage: retained.every((node) => node.coverage === 'complete-within-declared-bound')
      ? ('complete-within-declared-bound' as const)
      : ('partial' as const),
  };
}

export function authoringSourceGraph(model: PropertyModel): PropertySourceGraph {
  if (!model.unionAuthoring) return model.source.graph;
  const selected = selectedGraph(model, model.source.graph, (node) => node.id);
  return {
    ...cloneJson(model.source.graph),
    ...selected,
    ...(model.source.graph.resources
      ? {
          resources: {
            nodes: selected.nodes.length,
            edges: selected.nodes.reduce(
              (count, node) =>
                count +
                (node.fields?.length ?? 0) +
                (node.items?.length ?? 0) +
                (node.alternatives?.length ?? 0) +
                (node.indexSignatures?.length ?? 0),
              0,
            ),
          },
        }
      : {}),
    omittedCount: selected.coverage === 'partial' ? model.source.graph.omittedCount : 0,
  };
}

export function authoringLogicalGraph(model: PropertyModel, graph: LogicalSourceGraph): LogicalSourceGraph {
  if (!model.unionAuthoring) return graph;
  return { ...graph, ...selectedGraph<LogicalSourceNode>(model, graph, (node) => node.sourceNodeId) };
}
