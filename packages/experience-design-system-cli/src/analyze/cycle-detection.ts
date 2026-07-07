/**
 * Slot-dependency cycle detection.
 *
 * The Contentful Experience Design System backend rejects component manifests
 * that contain slot-dependency cycles at apply time — a topo-sort in the
 * apply worker refuses to create component types whose slot's
 * `$allowedComponents` transitively point back at themselves. Reference:
 * `experience-design-system-integrations` / services/design-system-sources-apply-worker/src/topo-sort.ts.
 *
 * We surface the same check locally so the wizard can:
 *   1. warn the operator at extract time (soft) with sidebar badges + banner,
 *   2. hard-block the push at manifest-finalization time before any API call.
 *
 * The algorithm is Johnson's — an O((V + E)(C + 1)) enumeration of all
 * elementary (simple) cycles in a directed graph. We need *elementary*
 * cycles rather than just cycle-existence because an operator can have
 * multiple independent cycles they need to address separately, and each
 * gets its own suggested fix.
 *
 * Johnson's algorithm reference: Donald B. Johnson, "Finding all the
 * elementary circuits of a directed graph." SIAM J. Comput., 4(1):77-84, 1975.
 */

/** A directed edge in the slot-dependency graph. */
export interface SlotEdge {
  fromComponent: string;
  slotName: string;
  toComponent: string;
}

/** A single elementary cycle, with `path[0] === path[path.length - 1]`. */
export interface SlotCycle {
  /** Component names visited, with the first repeated at the end. */
  path: string[];
  /** Ordered edges forming the cycle. `edges.length === path.length - 1`. */
  edges: SlotEdge[];
}

/** Input shape mirroring the slot definition on CDFComponentEntry. */
export interface ComponentSlotInfo {
  name: string;
  slots: Array<{ name: string; allowedComponents?: string[] }>;
}

/**
 * Build the adjacency map used by Johnson's algorithm from the raw component
 * list. Edges to unknown components (external references) are ignored — they
 * cannot participate in a cycle back to a known component through only
 * known-component edges.
 *
 * Self-loops (a slot on `A` allows `A`) are kept as edges; Johnson's SCC
 * decomposition surfaces them as trivial single-node SCCs which we handle
 * as a degenerate case below.
 */
interface AdjEntry {
  target: string;
  slotName: string;
}

function buildGraph(components: ComponentSlotInfo[]): {
  nodes: string[];
  adjacency: Map<string, AdjEntry[]>;
} {
  const nodes: string[] = [];
  const seen = new Set<string>();
  for (const c of components) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    nodes.push(c.name);
  }

  const adjacency = new Map<string, AdjEntry[]>();
  for (const node of nodes) adjacency.set(node, []);

  for (const comp of components) {
    const outgoing = adjacency.get(comp.name);
    if (!outgoing) continue;
    for (const slot of comp.slots) {
      const allowed = slot.allowedComponents ?? [];
      for (const target of allowed) {
        if (!seen.has(target)) continue; // unknown / external — ignore
        outgoing.push({ target, slotName: slot.name });
      }
    }
  }

  return { nodes, adjacency };
}

/**
 * Tarjan's strongly-connected-components algorithm — used by Johnson's
 * algorithm to constrain cycle search to one SCC at a time. Returns SCCs in
 * reverse-topological order.
 */
function stronglyConnectedComponents(nodes: string[], adjacency: Map<string, AdjEntry[]>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  const nodeSet = new Set(nodes);

  function strongconnect(v: string): void {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);

    const neighbours = adjacency.get(v) ?? [];
    for (const { target } of neighbours) {
      if (!nodeSet.has(target)) continue;
      if (!index.has(target)) {
        strongconnect(target);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(target)!));
      } else if (onStack.has(target)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(target)!));
      }
    }

    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const node of nodes) {
    if (!index.has(node)) strongconnect(node);
  }
  return sccs;
}

/**
 * Given a specific traversal `path` (component names) and the edge multiset
 * we walked to build it, materialize a `SlotCycle`. Because multiple parallel
 * edges may exist between the same two components (different slot names), we
 * carry the exact edges along the search rather than reconstructing them from
 * the node path.
 */
function makeCycle(path: string[], edges: SlotEdge[]): SlotCycle {
  return { path: [...path, path[0]], edges: [...edges] };
}

/**
 * Johnson's algorithm — enumerates all elementary (simple) cycles in the
 * slot-dependency graph. Self-loops are handled as a degenerate first pass
 * because Tarjan's SCC decomposition assigns a self-looping node to its own
 * single-node SCC, which Johnson's inner loop otherwise skips.
 */
export function findSlotCycles(components: ComponentSlotInfo[]): SlotCycle[] {
  if (components.length === 0) return [];

  const { nodes, adjacency } = buildGraph(components);
  if (nodes.length === 0) return [];

  const cycles: SlotCycle[] = [];

  // Degenerate case: self-loops. For any component whose slot allows itself,
  // emit a length-1 cycle before invoking Johnson's inner loop — Tarjan's
  // trivial single-node SCC test in Johnson's original paper only counts as
  // an SCC if the node participates in an edge, which we replicate here.
  for (const node of nodes) {
    const outgoing = adjacency.get(node) ?? [];
    for (const edge of outgoing) {
      if (edge.target === node) {
        cycles.push({
          path: [node, node],
          edges: [{ fromComponent: node, slotName: edge.slotName, toComponent: node }],
        });
      }
    }
  }

  // Johnson's main algorithm — iterate over remaining nodes in a fixed order,
  // decomposing the subgraph induced by `{node, ...higherOrder}` into SCCs,
  // and running the blocked-list circuit search rooted at the least node of
  // each non-trivial SCC. This is the classic formulation from the paper.
  const nodeOrder = [...nodes].sort();
  let remaining = [...nodeOrder];

  while (remaining.length > 0) {
    const subgraphNodes = remaining;
    const sccs = stronglyConnectedComponents(subgraphNodes, adjacency).filter((scc) => {
      if (scc.length > 1) return true;
      // Non-trivial single-node SCC iff the node has a self-loop within the
      // subgraph. We already emitted those above, so exclude here.
      return false;
    });

    if (sccs.length === 0) break;

    // Pick the SCC containing the lexicographically-smallest node — mirrors
    // the "least vertex" root selection in Johnson's paper.
    let startNode: string | null = null;
    let startScc: string[] | null = null;
    for (const scc of sccs) {
      const min = [...scc].sort()[0];
      if (startNode === null || min < startNode) {
        startNode = min;
        startScc = scc;
      }
    }
    if (startNode === null || startScc === null) break;

    const sccSet = new Set(startScc);
    const blocked = new Set<string>();
    const blockedMap = new Map<string, Set<string>>();
    const pathStack: string[] = [];
    const edgeStack: SlotEdge[] = [];

    function unblock(u: string): void {
      blocked.delete(u);
      const dependents = blockedMap.get(u);
      if (!dependents) return;
      for (const w of dependents) {
        if (blocked.has(w)) unblock(w);
      }
      dependents.clear();
    }

    function circuit(v: string, root: string): boolean {
      let foundCycle = false;
      pathStack.push(v);
      blocked.add(v);

      const outgoing = adjacency.get(v) ?? [];
      for (const { target: w, slotName } of outgoing) {
        if (!sccSet.has(w)) continue;
        edgeStack.push({ fromComponent: v, slotName, toComponent: w });
        if (w === root) {
          cycles.push(makeCycle(pathStack, edgeStack));
          foundCycle = true;
        } else if (!blocked.has(w)) {
          if (circuit(w, root)) foundCycle = true;
        }
        edgeStack.pop();
      }

      if (foundCycle) {
        unblock(v);
      } else {
        for (const { target: w } of outgoing) {
          if (!sccSet.has(w)) continue;
          let deps = blockedMap.get(w);
          if (!deps) {
            deps = new Set();
            blockedMap.set(w, deps);
          }
          deps.add(v);
        }
      }

      pathStack.pop();
      return foundCycle;
    }

    circuit(startNode, startNode);

    // Remove `startNode` from consideration and repeat with the reduced
    // subgraph. In classic Johnson's this is done by re-running SCC on the
    // subgraph induced by the remaining nodes.
    remaining = remaining.filter((n) => n !== startNode);
  }

  return cycles;
}

/**
 * Pick which edge is the best candidate to remove to break a cycle.
 * Heuristic: prefer removing the edge whose `toComponent` appears most often
 * as a destination across all cycles — that "hub" node is the biggest
 * contributor and removing an inbound edge to it likely breaks multiple
 * cycles at once. Falls back to the first edge in the cycle for
 * deterministic output when all candidates are tied.
 */
export function suggestCycleBreakEdge(cycle: SlotCycle, allCycles: SlotCycle[]): SlotEdge {
  if (cycle.edges.length === 0) {
    throw new Error('suggestCycleBreakEdge: cycle has no edges');
  }
  const indegree = new Map<string, number>();
  for (const c of allCycles) {
    for (const edge of c.edges) {
      indegree.set(edge.toComponent, (indegree.get(edge.toComponent) ?? 0) + 1);
    }
  }
  let best = cycle.edges[0];
  let bestScore = indegree.get(best.toComponent) ?? 0;
  for (const edge of cycle.edges) {
    const score = indegree.get(edge.toComponent) ?? 0;
    if (score > bestScore) {
      best = edge;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Format a cycle for the compact banner:
 *   `CardA → header → CardB → footer → CardA`
 *
 * Truncates at `maxHops` edges (default 8), inserting `…` mid-path so the
 * beginning and end remain visible. A hop is one edge; the returned string
 * for an n-edge cycle contains n+1 component names.
 */
export function formatCyclePath(cycle: SlotCycle, maxHops = 8): string {
  const arrow = ' → ';
  const parts: string[] = [];
  // Interleave: component, slot, component, slot, ..., final component
  // path.length === edges.length + 1.
  for (let i = 0; i < cycle.edges.length; i += 1) {
    parts.push(cycle.path[i]);
    parts.push(cycle.edges[i].slotName);
  }
  parts.push(cycle.path[cycle.path.length - 1]);

  if (cycle.edges.length <= maxHops) {
    return parts.join(arrow);
  }

  // Truncated: keep the first `keep` edges' worth of tokens and the final
  // component. Two "tokens per hop" (component + slot) plus the trailing
  // component name.
  const keepHops = Math.max(1, maxHops - 1);
  const keepTokens = keepHops * 2;
  const head = parts.slice(0, keepTokens).join(arrow);
  const tail = parts[parts.length - 1];
  return `${head}${arrow}…${arrow}${tail}`;
}
