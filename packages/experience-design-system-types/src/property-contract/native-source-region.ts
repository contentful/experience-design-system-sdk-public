import type { CDFFieldDefinition } from '../cdf/types.js';
import { cloneJson } from './json-value.js';
import type { LogicalSourceNode } from './logical-source-graph.js';
import { sourceDiscriminatedUnion } from './discriminated-union-source.js';

/** Derive only structures available at the target position, retaining nullish evidence separately. */
export function nativeSourceRegion(
  nodeId: string,
  nodes: ReadonlyMap<string, LogicalSourceNode>,
  position: 'root' | 'item' | 'field' = 'root',
  active = new Set<string>(),
  required?: boolean,
  region: 'ordinary' | 'union-branch' = 'ordinary',
): CDFFieldDefinition | undefined {
  const node = nodes.get(nodeId);
  if (
    !node ||
    active.has(nodeId) ||
    node.coverage !== 'complete-within-declared-bound' ||
    node.domain.unrepresentedValues?.length
  )
    return;
  const next = new Set(active).add(nodeId);
  const presence = required ?? node.required;
  const currentRegion = node.branchConditions?.length ? 'union-branch' : region;
  if (node.kind === 'reference' && node.alternatives?.length === 1)
    return nativeSourceRegion(node.alternatives[0]!, nodes, position, next, presence, currentRegion);
  if (node.kind === 'union') {
    const members = (node.alternatives ?? []).map((id) => nodes.get(id)!);
    const values = members.filter((member) => !['null', 'undefined', 'never'].includes(member.kind));
    if (values.length === 1) return nativeSourceRegion(values[0]!.id, nodes, position, next, presence, currentRegion);
    const union = sourceDiscriminatedUnion(node, nodes);
    if (union) {
      const members: CDFFieldDefinition[] = [];
      for (const branch of union.branches) {
        const member = nativeSourceRegion(branch.nodeId, nodes, 'item', next, presence, 'union-branch');
        if (!member?.$fields || member.$type !== 'record') return;
        member.$fields[union.discriminator] = {
          $type: 'Literal',
          $required: true,
          value: branch.tag,
          valueType: { $type: typeof branch.tag as 'string' | 'number' | 'boolean' },
        };
        members.push(member);
      }
      return { $type: 'DiscriminatedUnion', $required: presence, discriminator: union.discriminator, members };
    }
    const scalar = values[0]?.kind;
    if (
      !values.length ||
      !['string', 'number', 'boolean'].includes(scalar ?? '') ||
      values.some((member) => member.kind !== scalar)
    )
      return;
    const field: CDFFieldDefinition = { $type: scalar as 'string' | 'number' | 'boolean', $required: presence };
    applyChoices(field, node);
    return branchSingleton(field, currentRegion);
  }
  if (['string', 'number', 'boolean'].includes(node.kind)) {
    const field: CDFFieldDefinition = { $type: node.kind as 'string' | 'number' | 'boolean', $required: presence };
    applyChoices(field, node);
    return branchSingleton(field, currentRegion);
  }
  if (node.kind === 'array') {
    if (position !== 'root' || node.items?.length !== 1) return;
    const items = nativeSourceRegion(node.items[0]!, nodes, 'item', next, true, currentRegion);
    return items ? { $type: 'array', $required: presence, $items: items } : undefined;
  }
  if (
    (node.kind === 'record' || node.kind === 'intersection') &&
    position !== 'field' &&
    !node.indexSignatures?.length &&
    !node.callSignatures?.length
  ) {
    const fields: Record<string, CDFFieldDefinition> = Object.create(null);
    if (!node.fields || (node.kind === 'intersection' && !disjointRecordIntersection(node, nodes))) return;
    for (const field of node.fields) {
      const child = nativeSourceRegion(field.nodeId, nodes, 'field', next, field.required, currentRegion);
      if (!child) return;
      if (field.description) child.$description = field.description;
      fields[field.key] = child;
    }
    return { $type: 'record', $required: presence, $fields: fields };
  }
  return;
}

function branchSingleton(field: CDFFieldDefinition, region: 'ordinary' | 'union-branch'): CDFFieldDefinition {
  if (region !== 'union-branch' || field.$values?.length !== 1) return field;
  return {
    $type: 'Literal',
    $required: field.$required,
    value: field.$values[0]!,
    valueType: { $type: field.$type },
  };
}

function applyChoices(field: CDFFieldDefinition, node: LogicalSourceNode): void {
  const values = node.domain.declaredValues;
  if (
    node.domain.provenance === 'compiler' &&
    node.domain.openness === 'closed' &&
    values.length &&
    values.every((value) => typeof value === field.$type) &&
    !(field.$type === 'boolean' && values.length === 2 && values.includes(true) && values.includes(false))
  )
    field.$values = cloneJson(values);
}

function disjointRecordIntersection(node: LogicalSourceNode, nodes: ReadonlyMap<string, LogicalSourceNode>): boolean {
  const keys = new Set<string>();
  const seen = new Set<string>();
  const pending = [...(node.alternatives ?? [])];
  if (!pending.length) return false;
  while (pending.length) {
    const member = nodes.get(pending.pop()!)!;
    if (seen.has(member.id)) return false;
    seen.add(member.id);
    if (member.kind === 'reference' || member.kind === 'intersection') pending.push(...(member.alternatives ?? []));
    else {
      if (member.kind !== 'record' || member.indexSignatures?.length || member.callSignatures?.length) return false;
      for (const field of member.fields ?? []) {
        if (keys.has(field.key)) return false;
        keys.add(field.key);
      }
    }
  }
  return node.fields?.length === keys.size && node.fields.every((field) => keys.has(field.key));
}

export function sourceRecordFields(
  node: LogicalSourceNode,
  nodes: ReadonlyMap<string, LogicalSourceNode>,
): LogicalSourceNode['fields'] {
  return node.kind === 'record' || (node.kind === 'intersection' && disjointRecordIntersection(node, nodes))
    ? node.fields
    : undefined;
}
