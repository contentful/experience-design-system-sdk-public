/** A directed edge in the slot-dependency graph. */
export interface SlotEdge {
  fromComponent: string;
  slotName: string;
  toComponent: string;
}

/** A single elementary cycle, with `path[0] === path[path.length - 1]`. */
export interface SlotCycle {
  path: string[];
  edges: SlotEdge[];
}

/** Input shape mirroring the slot definition on CDFComponentEntry. */
export interface ComponentSlotInfo {
  name: string;
  slots: Array<{ name: string; allowedComponents?: string[] }>;
}

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
        if (!seen.has(target)) continue;
        outgoing.push({ target, slotName: slot.name });
      }
    }
  }

  return { nodes, adjacency };
}

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

function makeCycle(path: string[], edges: SlotEdge[]): SlotCycle {
  return { path: [...path, path[0]], edges: [...edges] };
}

export function findSlotCycles(components: ComponentSlotInfo[]): SlotCycle[] {
  if (components.length === 0) return [];

  const { nodes, adjacency } = buildGraph(components);
  if (nodes.length === 0) return [];

  const cycles: SlotCycle[] = [];

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

  const nodeOrder = [...nodes].sort();
  let remaining = [...nodeOrder];

  while (remaining.length > 0) {
    const subgraphNodes = remaining;
    const sccs = stronglyConnectedComponents(subgraphNodes, adjacency).filter((scc) => {
      if (scc.length > 1) return true;
      return false;
    });

    if (sccs.length === 0) break;

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

    remaining = remaining.filter((n) => n !== startNode);
  }

  return cycles;
}

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

export function formatCyclePath(cycle: SlotCycle, maxHops = 8): string {
  const arrow = ' → ';
  const parts: string[] = [];
  for (let i = 0; i < cycle.edges.length; i += 1) {
    parts.push(cycle.path[i]);
    parts.push(cycle.edges[i].slotName);
  }
  parts.push(cycle.path[cycle.path.length - 1]);

  if (cycle.edges.length <= maxHops) {
    return parts.join(arrow);
  }

  const keepHops = Math.max(1, maxHops - 1);
  const keepTokens = keepHops * 2;
  const head = parts.slice(0, keepTokens).join(arrow);
  const tail = parts[parts.length - 1];
  return `${head}${arrow}…${arrow}${tail}`;
}

export interface CyclePathSegment {
  kind: 'component' | 'slot' | 'arrow';
  text: string;
}

export function formatCyclePathSegments(cycle: SlotCycle, maxHops = 8): CyclePathSegment[] {
  const raw: CyclePathSegment[] = [];
  for (let i = 0; i < cycle.edges.length; i += 1) {
    raw.push({ kind: 'component', text: cycle.path[i] });
    raw.push({ kind: 'slot', text: `[${cycle.edges[i].slotName}]` });
  }
  raw.push({ kind: 'component', text: cycle.path[cycle.path.length - 1] });

  const withArrows = (segs: CyclePathSegment[]): CyclePathSegment[] => {
    const out: CyclePathSegment[] = [];
    for (let i = 0; i < segs.length; i += 1) {
      if (i > 0) out.push({ kind: 'arrow', text: ' → ' });
      out.push(segs[i]);
    }
    return out;
  };

  if (cycle.edges.length <= maxHops) {
    return withArrows(raw);
  }

  const keepHops = Math.max(1, maxHops - 1);
  const keepTokens = keepHops * 2;
  const head = raw.slice(0, keepTokens);
  const tail = raw[raw.length - 1];
  return withArrows([...head, { kind: 'component', text: '…' }, tail]);
}
