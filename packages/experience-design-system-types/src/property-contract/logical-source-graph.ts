import { contentDigest } from './content-digest.js';
import { cloneJson, own } from './json-value.js';
import { sourceDiscriminatedUnion } from './discriminated-union-source.js';
import {
  validateSourceGraph,
  validateSourceValue,
  type DefaultIntent,
  type PropertyModel,
  type SourceGraphDeclaration,
  type SourceGraphNode,
} from './property-model.js';

export interface LogicalBranchCondition {
  unionNodeId: string;
  memberIndex: number;
  sourceMemberNodeId: string;
  discriminator: string;
  tag: string | number | boolean;
}
export interface LogicalSourceNode extends SourceGraphNode {
  sourceNodeId: string;
  path: NonNullable<SourceGraphNode['path']>;
  readonly: boolean;
  occurrenceReadonly: boolean;
  intrinsicReadonly: boolean;
  defaultIntent?: DefaultIntent;
  branchConditions?: LogicalBranchCondition[];
  unionBranches?: {
    discriminator: string;
    branches: Array<{ memberIndex: number; nodeId: string; sourceNodeId: string; tag: string | number | boolean }>;
  };
}
export interface LogicalSourceGraph {
  authority: 'compiler';
  rootId: string;
  nodes: LogicalSourceNode[];
  coverage: PropertyModel['source']['graph']['coverage'];
}

/** Only own record fields identify a default; an array sample cannot establish item defaults. */
export function sourceDefaultAtPath(
  model: Pick<PropertyModel, 'source'>,
  path: LogicalSourceNode['path'],
): DefaultIntent | undefined {
  if (model.source.default?.state !== 'value' || !own(model.source.default, 'value')) return;
  let value = model.source.default.value!;
  const nodes = new Map(model.source.graph.nodes.map((node) => [node.id, node]));
  let node = nodes.get(model.source.graph.rootId);
  const resolve = (): void => {
    const seen = new Set<string>();
    while (node?.kind === 'reference' && !seen.has(node.id)) {
      seen.add(node.id);
      node = nodes.get(node.alternatives?.[0] ?? '');
    }
  };
  for (const segment of path) {
    resolve();
    if (segment.kind === 'union' || segment.kind === 'intersection') {
      const memberId = typeof segment.key === 'number' ? node?.alternatives?.[segment.key] : undefined;
      if (
        !memberId ||
        (segment.kind === 'union' && validateSourceValue(model.source.graph, value, '', memberId).length)
      )
        return;
      node = nodes.get(memberId);
      continue;
    }
    if (
      segment.kind !== 'field' ||
      typeof segment.key !== 'string' ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !own(value, segment.key)
    )
      return;
    value = value[segment.key]!;
    node = nodes.get(node?.fields?.find((field) => field.key === segment.key)?.nodeId ?? '');
  }
  return { action: 'set', value: cloneJson(value) };
}

/** Retain shared references while expanding finite occurrences with distinct branch ownership. */
export function prepareLogicalSourceGraph(model: Pick<PropertyModel, 'identity' | 'source'>): LogicalSourceGraph {
  const source = model.source.graph;
  const invalid = validateSourceGraph(source);
  if (invalid.length) throw new Error(invalid.map((issue) => issue.message).join('; '));
  if (
    model.identity.nodeId !== source.rootId ||
    Object.values(model.identity).some((value) => typeof value !== 'string' || !value)
  )
    throw new Error('Logical source root owner is incomplete or mismatched');
  const byId = new Map(source.nodes.map((node) => [node.id, node]));
  const parents = new Map<string, string[]>();
  for (const node of source.nodes)
    for (const childId of [
      ...(node.fields?.map((field) => field.nodeId) ?? []),
      ...(node.items ?? []),
      ...(node.alternatives ?? []),
      ...(node.indexSignatures?.map((signature) => signature.valueNodeId) ?? []),
    ])
      parents.set(childId, [...(parents.get(childId) ?? []), node.id]);
  const branchSensitive = new Set<string>();
  const pending = source.nodes.filter((node) => sourceDiscriminatedUnion(node, byId)).map((node) => node.id);
  while (pending.length) {
    const id = pending.pop()!;
    if (branchSensitive.has(id)) continue;
    branchSensitive.add(id);
    pending.push(...(parents.get(id) ?? []));
  }
  const intrinsicReadonly = (id: string): boolean => {
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.readonly === true) return true;
      if (current.kind === 'reference' && current.alternatives?.length === 1) {
        current = byId.get(current.alternatives[0]!);
      } else if (current.kind === 'union') {
        const values = (current.alternatives ?? [])
          .map((child) => byId.get(child)!)
          .filter((child) => !['null', 'undefined', 'never'].includes(child.kind));
        if (values.length !== 1) return false;
        current = values[0];
      } else return false;
    }
    return false;
  };
  const nodes: LogicalSourceNode[] = [];
  const canonical = new Map<string, string>();
  const activeSources = new Set<string>();
  let expandedOccurrences = 0;
  let occurrenceBoundReached = false;
  const root = byId.get(source.rootId)!;
  const rootPath = root.path ?? root.keyPath.map((key) => ({ kind: 'field' as const, key }));
  type Request = {
    sourceId: string;
    path: LogicalSourceNode['path'];
    required: boolean;
    readonly: boolean;
    declarations?: SourceGraphDeclaration[];
    target?: boolean;
    branchConditions?: LogicalBranchCondition[];
  };
  const visit = function* (request: Request): Generator<Request, string, string> {
    const original = byId.get(request.sourceId)!;
    const known = canonical.get(original.id);
    const sharedReference =
      known &&
      ((!request.branchConditions?.length && !branchSensitive.has(original.id)) || activeSources.has(original.id));
    if (sharedReference && request.target) return known;
    const boundedOccurrence = known && !sharedReference && expandedOccurrences >= (source.limits.maxEdges ?? 4096);
    const id = known
      ? 'occurrence_' +
        contentDigest({ owner: model.identity, sourceNodeId: original.id, path: request.path }).slice(0, 32)
      : original.id;
    const node: LogicalSourceNode = {
      ...cloneJson(original),
      id,
      sourceNodeId: original.id,
      path: cloneJson(request.path),
      required: request.required,
      readonly: request.readonly || intrinsicReadonly(original.id),
      occurrenceReadonly: request.readonly,
      intrinsicReadonly: intrinsicReadonly(original.id),
      ...(request.declarations ? { declarations: cloneJson(request.declarations) } : {}),
      ...(request.branchConditions?.length ? { branchConditions: cloneJson(request.branchConditions) } : {}),
    };
    const intent = sourceDefaultAtPath(model, request.path.slice(rootPath.length));
    if (intent) node.defaultIntent = intent;
    nodes.push(node);
    if (sharedReference || boundedOccurrence) {
      node.kind = 'reference';
      node.reason = boundedOccurrence ? 'branch-occurrence-expansion-bound' : 'shared-source-occurrence';
      if (boundedOccurrence) {
        node.coverage = 'partial';
        occurrenceBoundReached = true;
      }
      node.alternatives = [known];
      delete node.fields;
      delete node.items;
      delete node.indexSignatures;
      delete node.tupleElements;
      return id;
    }
    if (known) expandedOccurrences += 1;
    if (!known) canonical.set(original.id, id);
    activeSources.add(original.id);
    const child = (
      sourceId: string,
      kind: LogicalSourceNode['path'][number]['kind'],
      key: string | number,
      required = request.required,
      readonly = false,
      declarations?: SourceGraphDeclaration[],
    ): Request => ({
      sourceId,
      path: [...request.path, { kind, key }],
      required,
      readonly,
      ...(declarations ? { declarations } : {}),
      ...(request.branchConditions?.length ? { branchConditions: request.branchConditions } : {}),
    });
    if (original.fields) {
      node.fields = [];
      for (const field of original.fields) {
        const nodeId = yield child(
          field.nodeId,
          'field',
          field.key,
          field.required,
          field.readonly ?? false,
          field.declarations,
        );
        node.fields.push({ ...cloneJson(field), nodeId, path: [...request.path, { kind: 'field', key: field.key }] });
      }
    }
    if (original.items) {
      node.items = [];
      node.tupleElements = original.tupleElements ? [] : undefined;
      if (!original.tupleElements) delete node.tupleElements;
      for (const [index, sourceId] of original.items.entries()) {
        const tuple = original.tupleElements?.[index];
        const nodeId = yield child(
          sourceId,
          original.kind === 'tuple' ? 'tuple' : 'item',
          index,
          tuple ? !tuple.optional : true,
        );
        node.items.push(nodeId);
        if (tuple) node.tupleElements!.push({ ...cloneJson(tuple), nodeId });
      }
    }
    if (original.alternatives) {
      node.alternatives = [];
      const union = sourceDiscriminatedUnion(original, byId);
      if (union) node.unionBranches = { discriminator: union.discriminator, branches: [] };
      for (const [index, sourceId] of original.alternatives.entries()) {
        const branch = union?.branches.find((candidate) => candidate.memberIndex === index);
        const childRequest = child(sourceId, original.kind === 'intersection' ? 'intersection' : 'union', index);
        if (branch) {
          childRequest.required = true;
          childRequest.branchConditions = [
            ...(request.branchConditions ?? []),
            {
              unionNodeId: id,
              memberIndex: index,
              sourceMemberNodeId: sourceId,
              discriminator: union!.discriminator,
              tag: branch.tag,
            },
          ];
        }
        const nodeId =
          original.kind === 'reference'
            ? yield {
                sourceId,
                path: request.path,
                required: request.required,
                readonly: request.readonly,
                target: true,
                ...(request.branchConditions?.length ? { branchConditions: request.branchConditions } : {}),
              }
            : yield childRequest;
        node.alternatives.push(nodeId);
        if (branch)
          node.unionBranches!.branches.push({ memberIndex: index, nodeId, sourceNodeId: sourceId, tag: branch.tag });
      }
    }
    if (original.indexSignatures) {
      node.indexSignatures = [];
      for (const index of original.indexSignatures) {
        const valueNodeId = yield child(index.valueNodeId, 'index', index.keyType, false);
        node.indexSignatures.push({ ...cloneJson(index), valueNodeId });
      }
    }
    activeSources.delete(original.id);
    return id;
  };
  const frames = [
    visit({ sourceId: source.rootId, path: rootPath, required: root.required, readonly: root.readonly ?? false }),
  ];
  let returned = '';
  let rootId = '';
  while (frames.length) {
    const step = frames[frames.length - 1]!.next(returned);
    returned = '';
    if (step.done) {
      frames.pop();
      returned = step.value;
      if (!frames.length) rootId = returned;
    } else frames.push(visit(step.value));
  }
  if (canonical.size !== source.nodes.length) throw new Error('Logical compiler accounting is incomplete');
  return { authority: 'compiler', rootId, nodes, coverage: occurrenceBoundReached ? 'partial' : source.coverage };
}
