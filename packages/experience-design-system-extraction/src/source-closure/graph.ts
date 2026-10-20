import type { ClosureGraph, ClosureNode } from './types.js';
/** Each reachable identity, including an absent identity, is read once per invocation. */
export function buildClosureGraph<Local>(
  roots: readonly string[],
  readNode: (id: string) => ClosureNode<Local> | undefined,
  options: { signal?: AbortSignal } = {},
): ClosureGraph<Local> {
  const sortedRoots = [...new Set(roots)].sort();
  const pending = [...sortedRoots];
  const admitted = new Set(pending);
  const nodes = new Map<string, ClosureNode<Local>>();
  for (let index = 0; index < pending.length; index += 1) {
    options.signal?.throwIfAborted();
    const id = pending[index]!;
    const node = readNode(id);
    if (!node) continue;
    if (node.id !== id) throw new Error('Closure read returned a different identity');
    const edges = [
      ...new Map(node.edges.map((edge) => [JSON.stringify([edge.kind, edge.target]), { ...edge }])).values(),
    ].sort((a, b) => a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind));
    nodes.set(id, { ...node, edges, ends: node.ends.map((end) => ({ ...end })) });
    for (const edge of edges)
      if (!admitted.has(edge.target)) {
        admitted.add(edge.target);
        pending.push(edge.target);
      }
  }
  const sortedNodes = new Map([...nodes].sort(([a], [b]) => a.localeCompare(b)));
  for (const [id, node] of sortedNodes) {
    const missing = [
      ...new Set(node.edges.filter((edge) => !nodes.has(edge.target)).map((edge) => edge.target)),
    ].sort();
    sortedNodes.set(id, {
      ...node,
      ends: [
        ...node.ends,
        ...missing.map((target) => ({ kind: 'open' as const, reason: 'unresolved-target', target })),
      ],
    });
  }
  return { roots: sortedRoots, missingRoots: sortedRoots.filter((root) => !nodes.has(root)), nodes: sortedNodes };
}
