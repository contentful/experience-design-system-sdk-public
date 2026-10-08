import type { SlotCycle } from '../../types/graph.js';

const ARROW = ' → ';

/** Human-readable cycle path string, truncated with "…" when > maxHops. */
export function formatCyclePath(cycle: SlotCycle, maxHops = 8): string {
  const parts: string[] = [];
  for (let i = 0; i < cycle.edges.length; i += 1) {
    parts.push(cycle.path[i]);
    parts.push(cycle.edges[i].slotName);
  }
  parts.push(cycle.path[cycle.path.length - 1]);

  if (cycle.edges.length <= maxHops) {
    return parts.join(ARROW);
  }

  const keepHops = Math.max(1, maxHops - 1);
  const keepTokens = keepHops * 2;
  const head = parts.slice(0, keepTokens).join(ARROW);
  const tail = parts[parts.length - 1];
  return `${head}${ARROW}…${ARROW}${tail}`;
}
