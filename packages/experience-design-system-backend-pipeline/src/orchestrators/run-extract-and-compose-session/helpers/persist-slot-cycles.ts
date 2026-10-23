import type { DatabaseSync } from 'node:sqlite';
import { findSlotCycles } from '../../../steps/composition/src/helpers/cycles/find-slot-cycles.js';
import { suggestCycleBreakEdge } from '../../../steps/composition/src/helpers/cycles/suggest-cycle-break-edge.js';
import { storeSlotCycles } from '../../../persistence/src/session/repositories/db.js';
import { retryDatabaseWrite } from './retry-database-write.js';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';

/**
 * Detect slot-reference cycles across the composed component graph, annotate
 * each with a suggested break edge, and write them into the session DB. The
 * selection + apply TUIs read these rows to surface cycle warnings during
 * review and to refuse applying a cyclic composition.
 */
export async function persistSlotCycles(
  db: DatabaseSync,
  sessionId: string,
  components: RawComponentDefinition[],
): Promise<void> {
  const graph = components.map((c) => ({
    name: c.name,
    slots: c.slots.map((s) => ({ name: s.name, allowedComponents: s.allowedComponents })),
  }));
  const cycles = findSlotCycles(graph);
  const withBreaks = cycles.map((cycle) => ({ ...cycle, suggestedBreak: suggestCycleBreakEdge(cycle, cycles) }));
  await retryDatabaseWrite(() => storeSlotCycles(db, sessionId, withBreaks));
}
