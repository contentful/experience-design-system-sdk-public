import type { Closure, NodeStatus } from '../types/graph.js';

const STATUS_RANK: Record<NodeStatus, number> = { ok: 0, warning: 1, error: 2 };

/**
 * Given an ancestor whose status is inherited (not its own), pick the
 * descendant that caused the worst status — tie-broken by shortest hop
 * distance from the ancestor. Returns null when the ancestor has a direct
 * issue (no drill-down needed) or when no issued descendant exists.
 */
export function findWorstIssuedDescendant(
  ancestor: string,
  closure: Closure,
  directIssues: Map<string, NodeStatus>,
): string | null {
  const ancestorDirect = directIssues.get(ancestor);
  if (ancestorDirect && ancestorDirect !== 'ok') return null;

  const candidates: Array<{ name: string; status: NodeStatus; depthFromAncestor: number }> = [];
  for (const node of closure.nodes) {
    if (node.name === ancestor) continue;
    const idx = node.path.indexOf(ancestor);
    if (idx === -1) continue;
    const status = directIssues.get(node.name);
    if (!status || status === 'ok') continue;
    const depthFromAncestor = node.path.length - 1 - idx;
    candidates.push({ name: node.name, status, depthFromAncestor });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const r = STATUS_RANK[b.status] - STATUS_RANK[a.status];
    if (r !== 0) return r;
    if (a.depthFromAncestor !== b.depthFromAncestor) return a.depthFromAncestor - b.depthFromAncestor;
    return a.name.localeCompare(b.name);
  });
  return candidates[0].name;
}
