import type { CyclePathSegment, SlotCycle } from '../../types/graph.js';

/** Structured path segments (for a TUI renderer) with "…" truncation at maxHops. */
export function formatCyclePathSegments(cycle: SlotCycle, maxHops = 8): CyclePathSegment[] {
  const raw: CyclePathSegment[] = [];
  for (let i = 0; i < cycle.edges.length; i += 1) {
    raw.push({ kind: 'component', text: cycle.path[i] });
    raw.push({ kind: 'slot', text: `[${cycle.edges[i].slotName}]` });
  }
  raw.push({ kind: 'component', text: cycle.path[cycle.path.length - 1] });

  if (cycle.edges.length <= maxHops) return interleaveWithArrows(raw);

  const keepHops = Math.max(1, maxHops - 1);
  const keepTokens = keepHops * 2;
  const head = raw.slice(0, keepTokens);
  const tail = raw[raw.length - 1];
  return interleaveWithArrows([...head, { kind: 'component', text: '…' }, tail]);
}

function interleaveWithArrows(segs: CyclePathSegment[]): CyclePathSegment[] {
  const out: CyclePathSegment[] = [];
  for (let i = 0; i < segs.length; i += 1) {
    if (i > 0) out.push({ kind: 'arrow', text: ' → ' });
    out.push(segs[i]);
  }
  return out;
}
