import { discriminatedUnionTag } from './discriminated-union.js';
import { validateTargetDefinition, type TargetDefinition } from './target-definition.js';
import { childPath, jsonEqual, own, type JsonValue, type PropertyIssue } from './json-value.js';
import {
  validateSourceGraph,
  validateSourceValue,
  type PropertySourceGraph,
  type SourceGraphNode,
} from './property-model.js';
import { finiteSourceValueDomain } from './source-representation.js';

export interface SourceUnionBranch {
  memberIndex: number;
  nodeId: string;
  tagNodeId: string;
  tag: string | number | boolean;
}
export interface SourceDiscriminatedUnion {
  discriminator: string;
  branches: SourceUnionBranch[];
}

function referenceValue(
  node: SourceGraphNode,
  nodes: ReadonlyMap<string, SourceGraphNode>,
): SourceGraphNode | undefined {
  const active = new Set<string>();
  let current: SourceGraphNode | undefined = node;
  while (current?.kind === 'reference') {
    if (active.has(current.id) || current.alternatives?.length !== 1) return;
    active.add(current.id);
    current = nodes.get(current.alternatives[0]!);
  }
  return current;
}

/** Complete compiler field edges establish tags independently of observed callers. */
export function sourceDiscriminatedUnion(
  node: SourceGraphNode,
  nodes: ReadonlyMap<string, SourceGraphNode>,
  discriminator?: string,
): SourceDiscriminatedUnion | undefined {
  if (node.kind !== 'union' || node.coverage !== 'complete-within-declared-bound') return;
  const members = (node.alternatives ?? []).map((id, memberIndex) => ({ node: nodes.get(id), memberIndex }));
  if (members.length < 2) return;
  if (members.some((member) => !member.node || ['null', 'undefined', 'never'].includes(member.node.kind))) return;
  const first = referenceValue(members[0]!.node!, nodes);
  if (!first) return;
  const keys = discriminator === undefined ? (first.fields ?? []).map((field) => field.key).sort() : [discriminator];
  for (const key of keys) {
    const branches: SourceUnionBranch[] = [];
    const tags: JsonValue[] = [];
    for (const member of members) {
      const branch = referenceValue(member.node!, nodes);
      if (!branch) break;
      const field = branch.fields?.find((edge) => edge.key === key);
      const originalTag = field && nodes.get(field.nodeId);
      const tag = originalTag && referenceValue(originalTag, nodes);
      const value = tag?.domain.declaredValues[0];
      if (
        !['record', 'intersection'].includes(branch.kind) ||
        branch.coverage !== 'complete-within-declared-bound' ||
        !field?.required ||
        !tag ||
        tag.domain.provenance !== 'compiler' ||
        tag.coverage !== 'complete-within-declared-bound' ||
        tag.kind !== typeof value ||
        tag.domain.openness !== 'closed' ||
        tag.domain.unrepresentedValues?.length ||
        tag.domain.declaredValues.length !== 1 ||
        !(
          typeof value === 'string' ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value))
        ) ||
        tags.some((other) => jsonEqual(other, value))
      )
        break;
      tags.push(value);
      branches.push({ memberIndex: member.memberIndex, nodeId: member.node!.id, tagNodeId: field.nodeId, tag: value });
    }
    if (branches.length === members.length) return { discriminator: key, branches };
  }
  return;
}

/** Match each target branch to the original compiler member through its exact typed tag. */
export function validateDiscriminatedUnionSourceDefinition(
  definition: TargetDefinition,
  graph: PropertySourceGraph,
  nodeId = graph.rootId,
): PropertyIssue[] {
  const validation = validateTargetDefinition(definition);
  const issues = [...validation.issues, ...validateSourceGraph(graph)];
  if (issues.length) return issues;
  if (graph.coverage !== 'complete-within-declared-bound' || graph.omittedCount)
    return [{ path: '/source', message: 'Union requires a complete original compiler graph' }];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const match = (
    desired: TargetDefinition,
    id: string,
    path: string,
    active: Set<string>,
    required?: boolean,
  ): void => {
    const node = nodes.get(id);
    const fail = (message: string): void => {
      issues.push({ path, message });
    };
    if (!node || active.has(id)) {
      fail('Union source relationship is missing or recursive');
      return;
    }
    if (
      node.coverage !== 'complete-within-declared-bound' ||
      node.nullability?.compilerMode !== 'enabled' ||
      node.nullability.null.state !== 'absent' ||
      node.nullability.undefined.state !== 'absent' ||
      node.domain.unrepresentedValues?.length
    ) {
      fail('Union requires established complete non-nullish compiler value states');
      return;
    }
    const next = new Set(active).add(id);
    const expectedRequired = required ?? node.required;
    if (desired.required !== undefined && desired.required !== expectedRequired)
      fail('Union field requiredness differs from its compiler occurrence');
    if (desired.values?.length && !['String', 'Number', 'Boolean', 'Literal'].includes(desired.type))
      fail('Union structure cannot add unproven whole-value constraints');
    if (own(desired, 'defaultValue'))
      issues.push(...validateSourceValue(graph, desired.defaultValue!, childPath(path, 'defaultValue'), id));
    if (node.kind === 'reference' && node.alternatives?.length === 1) {
      match(desired, node.alternatives[0]!, path, next, expectedRequired);
      return;
    }
    if (desired.type === 'DiscriminatedUnion') {
      const binding = sourceDiscriminatedUnion(node, nodes, desired.discriminator);
      if (!binding || binding.branches.length !== desired.members!.length) {
        fail('Union must retain the exact complete compiler discriminator and member set');
        return;
      }
      const selected = new Set<number>();
      desired.members!.forEach((member, index) => {
        const tag = discriminatedUnionTag(member, desired.discriminator!, 'target')!;
        const branch = binding.branches.find((candidate) => jsonEqual(candidate.tag, tag.value));
        if (!branch || selected.has(branch.memberIndex)) {
          fail('Union member requires one unique matching compiler tag');
          return;
        }
        selected.add(branch.memberIndex);
        match(member, branch.nodeId, childPath(childPath(path, 'members'), index), next, expectedRequired);
      });
      return;
    }
    if (desired.type === 'Record') {
      const fields = node.fields;
      if (
        !['record', 'intersection'].includes(node.kind) ||
        node.callSignatures?.length ||
        node.indexSignatures?.length ||
        !fields ||
        fields.length !== Object.keys(desired.fields!).length
      ) {
        fail('Union Record must retain every exact compiler field');
        return;
      }
      for (const field of fields) {
        const target = desired.fields![field.key];
        if (!Object.hasOwn(desired.fields!, field.key) || target.required !== field.required) {
          fail('Union field name and requiredness must match its compiler occurrence');
          continue;
        }
        match(target, field.nodeId, childPath(childPath(path, 'fields'), field.key), next, field.required);
      }
      return;
    }
    if (desired.type === 'Array') {
      if (node.kind !== 'array' || node.items?.length !== 1) fail('Union Array must retain its exact compiler item');
      else match(desired.items!, node.items[0]!, childPath(path, 'items'), next);
      return;
    }
    if (desired.type === 'Literal') {
      const type = typeof desired.value;
      if (
        node.domain.provenance !== 'compiler' ||
        node.domain.openness !== 'closed' ||
        node.domain.declaredValues.length !== 1 ||
        !jsonEqual(node.domain.declaredValues[0], desired.value) ||
        node.kind !== type ||
        !['string', 'number', 'boolean'].includes(type) ||
        (desired.valueType!.type !==
          ({ string: 'String', number: 'Number', boolean: 'Boolean' } as const)[
            type as 'string' | 'number' | 'boolean'
          ] &&
          !(type === 'number' && desired.valueType!.type === 'Integer' && Number.isSafeInteger(desired.value)))
      )
        fail('Union Literal must retain its exact typed compiler singleton');
      return;
    }
    const type = { String: 'string', Number: 'number', Boolean: 'boolean' }[
      desired.type as 'String' | 'Number' | 'Boolean'
    ];
    const values = finiteSourceValueDomain(graph, id);
    const intrinsicBoolean =
      type === 'boolean' && values?.length === 2 && values.includes(false) && values.includes(true);
    const finitePrimitive = type && values?.length && values.every((value) => typeof value === type);
    if (!type || (node.kind !== type && !finitePrimitive)) fail('Union branch must preserve its exact compiler type');
    if (
      values?.length &&
      !intrinsicBoolean &&
      (!desired.values?.length ||
        values.length !== desired.values.length ||
        values.some((value) => !desired.values!.some((allowed) => jsonEqual(allowed, value))))
    )
      fail('Union branch must preserve its complete compiler domain');
    if (
      desired.values?.length &&
      (!values?.length || desired.values.some((allowed) => !values.some((value) => jsonEqual(allowed, value))))
    )
      fail('Union branch cannot narrow an unproven or open compiler domain');
  };
  match(definition, nodeId, '', new Set());
  return issues;
}
