import type { DatabaseSync } from 'node:sqlite';

/** Exact matches win; ambiguous case matches and local collisions retain their generated IDs. */
export function resolveComponentIds(
  generatedIds: readonly string[],
  existingIds: readonly string[],
): Map<string, string> {
  const generated = [...new Set(generatedIds)];
  const existing = new Set(existingIds);
  const existingByLowerCase = new Map<string, string[]>();
  for (const id of existing) {
    const key = id.toLowerCase();
    existingByLowerCase.set(key, [...(existingByLowerCase.get(key) ?? []), id]);
  }
  const generatedPerLowerCase = new Map<string, number>();
  for (const id of generated) {
    const key = id.toLowerCase();
    generatedPerLowerCase.set(key, (generatedPerLowerCase.get(key) ?? 0) + 1);
  }
  return new Map(
    generated.map((id) => {
      const key = id.toLowerCase();
      const matches = existingByLowerCase.get(key) ?? [];
      const collision = (generatedPerLowerCase.get(key) ?? 0) > 1;
      return [id, !existing.has(id) && matches.length === 1 && !collision ? matches[0]! : id];
    }),
  );
}

/** Persist the exported ID in the existing name field, together with its slot references. */
export function alignComponentIds(db: DatabaseSync, sessionId: string, existingIds: readonly string[]): void {
  const components = db.prepare('SELECT name FROM raw_components WHERE session_id = ?').all(sessionId) as {
    name: string;
  }[];
  const ids = resolveComponentIds(
    components.map((c) => c.name),
    existingIds,
  );
  const slots = db
    .prepare('SELECT rowid, allowed_component FROM raw_slot_allowed_components WHERE session_id = ?')
    .all(sessionId) as { rowid: number; allowed_component: string }[];
  const updateComponent = db.prepare('UPDATE raw_components SET name = ? WHERE session_id = ? AND name = ?');
  const updateSlot = db.prepare('UPDATE raw_slot_allowed_components SET allowed_component = ? WHERE rowid = ?');
  db.exec('BEGIN');
  try {
    for (const [name, id] of ids) {
      if (name !== id) updateComponent.run(id, sessionId, name);
    }
    const slotIds = new Map<string, string>();
    for (const slot of slots) {
      if (!slotIds.has(slot.allowed_component)) {
        slotIds.set(
          slot.allowed_component,
          ids.get(slot.allowed_component) ??
            resolveComponentIds([slot.allowed_component], existingIds).get(slot.allowed_component)!,
        );
      }
      const id = slotIds.get(slot.allowed_component)!;
      if (slot.allowed_component !== id) updateSlot.run(id, slot.rowid);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
