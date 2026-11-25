import type { SourceGraphNode } from './property-model.js';

export function sourceGraphChildIds(node: SourceGraphNode): string[] {
  return [
    ...(node.fields?.map((field) => field.nodeId) ?? []),
    ...(node.items ?? []),
    ...(node.alternatives ?? []),
    ...(node.indexSignatures?.map((signature) => signature.valueNodeId) ?? []),
  ];
}

export function reachableSourceNodeIds(rootId: string, childIds: (id: string) => string[]): Set<string> {
  const reachable = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    pending.push(...childIds(id));
  }
  return reachable;
}
