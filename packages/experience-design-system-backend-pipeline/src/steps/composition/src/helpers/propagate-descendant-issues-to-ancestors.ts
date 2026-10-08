import type { Closure, NodeStatus, RenderStatus } from '../types/graph.js';

const STATUS_RANK: Record<NodeStatus, number> = { ok: 0, warning: 1, error: 2 };
const RANK_STATUS: NodeStatus[] = ['ok', 'warning', 'error'];

/**
 * For each node in the closure, surface the worst status among its descendants
 * so an ancestor shows a bubble when any descendant has an issue. `isOwn`
 * indicates whether the status is the node's own direct issue vs inherited.
 */
export function propagateDescendantIssuesToAncestors(
  closure: Closure,
  directIssues: Map<string, NodeStatus>,
): Map<string, RenderStatus> {
  const out = new Map<string, RenderStatus>();
  if (closure.nodes.length === 0) return out;

  const own = new Map<string, NodeStatus>();
  for (const node of closure.nodes) {
    const s = directIssues.get(node.name);
    if (s && s !== 'ok') own.set(node.name, s);
  }

  const inheritedSources = new Map<string, Map<string, NodeStatus>>();
  for (const node of closure.nodes) {
    const ownStatus = own.get(node.name);
    if (!ownStatus) continue;
    for (let i = 0; i < node.path.length - 1; i++) {
      const ancestor = node.path[i];
      if (!inheritedSources.has(ancestor)) inheritedSources.set(ancestor, new Map());
      (inheritedSources.get(ancestor) as Map<string, NodeStatus>).set(node.name, ownStatus);
    }
  }

  for (const [name, status] of own.entries()) {
    out.set(name, { status, isOwn: true, sourceComponents: [name] });
  }
  for (const [ancestor, sources] of inheritedSources.entries()) {
    if (out.has(ancestor)) continue;
    const sourceNames = [...sources.keys()].sort();
    const status = worstOf([...sources.values()]);
    out.set(ancestor, { status, isOwn: false, sourceComponents: sourceNames });
  }
  return out;
}

function worstOf(statuses: NodeStatus[]): NodeStatus {
  let worst = 0;
  for (const s of statuses) {
    const r = STATUS_RANK[s];
    if (r > worst) worst = r;
  }
  return RANK_STATUS[worst];
}
