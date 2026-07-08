import type { Closure, NodeStatus } from './composite-closure.js';

export interface IssueLocation {
  component: string;
  status: NodeStatus;
}

export interface RenderStatus {
  status: NodeStatus;
  isOwn: boolean;
  sourceComponents: string[];
}

const STATUS_RANK: Record<NodeStatus, number> = { ok: 0, warning: 1, error: 2 };
const RANK_STATUS: NodeStatus[] = ['ok', 'warning', 'error'];

function worstOf(statuses: NodeStatus[]): NodeStatus {
  let worst = 0;
  for (const s of statuses) {
    const r = STATUS_RANK[s];
    if (r > worst) worst = r;
  }
  return RANK_STATUS[worst];
}

/**
 * Compute render statuses for each node in a closure, given the set of nodes
 * that have direct, real issues. Ancestors of a node with an issue receive an
 * inherited render entry whose status is the worst-case of its descendant
 * issues and whose sourceComponents list all descendants with direct issues.
 */
export function computeRenderStatuses(
  closure: Closure,
  directIssues: Map<string, NodeStatus>,
): Map<string, RenderStatus> {
  const out = new Map<string, RenderStatus>();
  if (closure.nodes.length === 0) return out;

  const nodesByName = new Map<string, { name: string; path: string[] }>();
  for (const node of closure.nodes) {
    nodesByName.set(node.name, { name: node.name, path: node.path });
  }

  // For every node in the closure that has a direct issue, mark every prefix
  // node in its path (i.e., every ancestor including itself along the shortest
  // path from root) as being affected. The node itself gets isOwn=true; each
  // strict ancestor gets isOwn=false with the descendant recorded as a source.
  //
  // Descendant relationship: A is an ancestor of B iff A appears in B.path
  // (which is the shortest path from root to B) at a position before B. Note
  // this uses the ONE canonical shortest path. For pure-inheritance semantics
  // — a node has an inherited issue iff any node reachable from it in the
  // closure has an issue — we need transitive descendants. In this closure
  // model, every node's `path` field gives its shortest-path ancestor chain,
  // and every ancestor along that chain is transitively a "container" of that
  // node. That is sufficient here because the closure is rooted and a node is
  // reachable from the root iff it appears in the closure.

  // Aggregate direct issues on each node.
  const own = new Map<string, NodeStatus>();
  for (const node of closure.nodes) {
    const s = directIssues.get(node.name);
    if (s && s !== 'ok') own.set(node.name, s);
  }

  // For each node with a direct issue, walk its shortest-path ancestor chain
  // and register the descendant as a source on each ancestor.
  const inheritedSources = new Map<string, Map<string, NodeStatus>>();
  for (const node of closure.nodes) {
    const ownStatus = own.get(node.name);
    if (!ownStatus) continue;
    // Every entry in node.path except the last (node itself) is an ancestor.
    for (let i = 0; i < node.path.length - 1; i++) {
      const ancestor = node.path[i];
      if (!inheritedSources.has(ancestor)) inheritedSources.set(ancestor, new Map());
      inheritedSources.get(ancestor)!.set(node.name, ownStatus);
    }
  }

  // Emit own-issue entries.
  for (const [name, status] of own.entries()) {
    out.set(name, {
      status,
      isOwn: true,
      sourceComponents: [name],
    });
  }

  // Emit inherited entries (skip nodes that already have their own issue).
  for (const [ancestor, sources] of inheritedSources.entries()) {
    if (out.has(ancestor)) continue;
    const sourceNames = [...sources.keys()].sort();
    const status = worstOf([...sources.values()]);
    out.set(ancestor, {
      status,
      isOwn: false,
      sourceComponents: sourceNames,
    });
  }

  return out;
}

/**
 * Given an ancestor showing an inherited marker, return the descendant the
 * user should drill to. Deterministic: worst-status first; then shortest path
 * from the ancestor; then alphabetical.
 */
export function pickDrillTarget(
  ancestor: string,
  closure: Closure,
  directIssues: Map<string, NodeStatus>,
): string | null {
  // If the ancestor itself has a direct issue, there is nothing to drill to.
  const ancestorDirect = directIssues.get(ancestor);
  if (ancestorDirect && ancestorDirect !== 'ok') return null;

  const nodesByName = new Map<string, { name: string; path: string[] }>();
  for (const node of closure.nodes) nodesByName.set(node.name, node);

  const ancestorNode = nodesByName.get(ancestor);
  if (!ancestorNode) return null;

  // Collect descendants of `ancestor` (nodes whose path contains ancestor
  // before the terminal element) that have their own issue.
  const candidates: Array<{ name: string; status: NodeStatus; depthFromAncestor: number }> = [];
  const ancestorDepth = ancestorNode.path.length - 1;
  for (const node of closure.nodes) {
    if (node.name === ancestor) continue;
    const idx = node.path.indexOf(ancestor);
    if (idx === -1) continue; // not a descendant of ancestor
    const status = directIssues.get(node.name);
    if (!status || status === 'ok') continue;
    // depthFromAncestor is number of edges between ancestor and node along
    // the shortest path from root. Since `path` is the shortest path from
    // root, path.length-1 == node.depth and idx == ancestor.depth along that
    // path, so distance = (node.path.length - 1) - idx.
    const depthFromAncestor = node.path.length - 1 - idx;
    void ancestorDepth;
    candidates.push({ name: node.name, status, depthFromAncestor });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const rDiff = STATUS_RANK[b.status] - STATUS_RANK[a.status]; // worst first
    if (rDiff !== 0) return rDiff;
    if (a.depthFromAncestor !== b.depthFromAncestor) {
      return a.depthFromAncestor - b.depthFromAncestor;
    }
    return a.name.localeCompare(b.name);
  });

  return candidates[0].name;
}
