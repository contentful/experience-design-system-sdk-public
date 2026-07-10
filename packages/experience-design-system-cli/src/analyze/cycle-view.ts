import type { SlotCycle } from './cycle-detection.js';
import { findSlotCycles } from './cycle-detection.js';
import { buildComponentGraph, type SlotGraphInput } from './slot-graph.js';

/**
 * Reified two-graph split for the GenerateReview screen (ADR-0010 Part 3,
 * plan §4.2). Replaces the previously-implicit pairing of the `slotCycles`
 * state (filtered graph → push-safety) and `cycleParticipantsMemo`
 * (unfiltered graph → structural cycle badges).
 *
 * Semantics per field:
 * - `pushBlocking` — cycles surviving the "won't ship" filter. Every
 *   participant here is currently NOT rejected, so these cycles WILL be in
 *   the accepted push subset unless the operator resolves them. Drives the
 *   push-safety banner, the `[F]` continue gate, the `[c]` cycle-detail
 *   panel, and DB persistence via storeSlotCycles/loadSlotCycles.
 * - `structural` — every component that participates in ANY cycle in the
 *   current UNFILTERED graph, regardless of reject state. Drives sidebar
 *   `(cycle)` badges, task #37 mount auto-reject targeting, and cycle-child
 *   injection in GroupedSidebar (`hasCycleDepDirect`).
 */
export interface CycleView {
  pushBlocking: SlotCycle[];
  structural: Set<string>;
}

/**
 * Compute a {@link CycleView} from the current review-component list. Delegates
 * edge construction to {@link buildComponentGraph} — one canonical source per
 * ADR-0010 Part 3. Never throws: a malformed `$slots` shape is swallowed the
 * same way the legacy `recomputeCycles` / `cycleParticipantsMemo` did.
 */
export function computeCycleView(components: SlotGraphInput[]): CycleView {
  const filtered = components.filter((c) => c.status !== 'rejected');
  const filteredGraph = buildComponentGraph(filtered);
  const unfilteredGraph = buildComponentGraph(components);

  let pushBlocking: SlotCycle[] = [];
  const structural = new Set<string>();

  try {
    pushBlocking = findSlotCycles(filteredGraph);
    for (const cyc of pushBlocking) for (const p of cyc.path) structural.add(p);
  } catch {
    // Malformed slot data — swallow (matches recomputeCycles' try/catch).
  }
  try {
    const unfilteredCycles = findSlotCycles(unfilteredGraph);
    for (const cyc of unfilteredCycles) for (const p of cyc.path) structural.add(p);
  } catch {
    // Same.
  }

  return { pushBlocking, structural };
}
