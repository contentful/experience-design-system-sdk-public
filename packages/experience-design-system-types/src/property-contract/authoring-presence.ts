import type { SourceGraphNode } from './property-model.js';

export const AUTHORING_PRESENCE_POLICY = 'nullable-as-optional-v1' as const;

export function sourceAllowsNull(
  node: SourceGraphNode,
  nodes: ReadonlyMap<string, SourceGraphNode>,
  active = new Set<string>(),
): boolean {
  if (active.has(node.id)) return false;
  if (node.kind === 'null') return true;
  if (node.nullability?.null.state === 'present' && ['compiler', 'syntax'].includes(node.nullability.null.source))
    return true;
  if (!['union', 'reference'].includes(node.kind)) return false;
  const next = new Set(active).add(node.id);
  return (node.alternatives ?? []).some((id) => {
    const member = nodes.get(id);
    return member !== undefined && sourceAllowsNull(member, nodes, next);
  });
}

export interface AuthoringPresence {
  required: boolean;
  unset: 'null' | 'omit' | 'unavailable';
  preservesPosition: boolean;
}

export function authoringPresence(
  node: SourceGraphNode,
  nodes: ReadonlyMap<string, SourceGraphNode>,
  sourceKeyRequired = node.required,
): AuthoringPresence {
  const nullable = sourceAllowsNull(node, nodes);
  const position = node.path?.filter((segment) => !['union', 'intersection'].includes(segment.kind)).at(-1)?.kind;
  const preservesPosition = position === 'item' || position === 'tuple';
  return {
    required: sourceKeyRequired && !nullable,
    unset: nullable && (sourceKeyRequired || preservesPosition) ? 'null' : sourceKeyRequired ? 'unavailable' : 'omit',
    preservesPosition,
  };
}
