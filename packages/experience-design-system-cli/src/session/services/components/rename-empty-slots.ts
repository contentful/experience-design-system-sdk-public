import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from '../../repositories/shared/with-transaction.js';
import { getEmptyRawSlots, updateRawSlotName } from '../../repositories/components/cdf/write.js';

export function renameEmptySlots(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  componentName: string,
  slotCount: number,
): { renames: Array<{ oldName: string; newName: string }>; warnings: string[] } {
  const emptySlots = getEmptyRawSlots(db, sessionId, componentId);
  if (emptySlots.length === 0) return { renames: [], warnings: [] };

  const renames: Array<{ oldName: string; newName: string }> = [];
  const warnings: string[] = [];

  withTransaction(db, () => {
    for (const slot of emptySlots) {
      const newName = slotCount === 1 ? 'children' : `slot_${slot.position}`;
      updateRawSlotName(db, sessionId, componentId, slot.name, slot.position, newName);
      renames.push({ oldName: slot.name, newName });
      warnings.push(
        `${componentName}: slot at position ${slot.position} had empty name — renamed to "${newName}" for classification`,
      );
    }
  });

  return { renames, warnings };
}
