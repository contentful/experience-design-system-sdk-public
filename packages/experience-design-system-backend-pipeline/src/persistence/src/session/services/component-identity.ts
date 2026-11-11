import type { DatabaseSync } from 'node:sqlite';

/** Exact matches win; ambiguous case matches and local collisions retain their generated IDs. */
export function resolveComponentIds(
  generatedIds: readonly string[],
  existingIds: readonly string[],
): Map<string, string> {
  const generated = [...new Set(generatedIds)];
  const existing = [...new Set(existingIds)];
  return new Map(
    generated.map((id) => {
      const matches = existing.filter((candidate) => candidate.toLowerCase() === id.toLowerCase());
      const collision = generated.some((candidate) => candidate !== id && candidate.toLowerCase() === id.toLowerCase());
      return [id, !existing.includes(id) && matches.length === 1 && !collision ? matches[0]! : id];
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
    for (const slot of slots) {
      const id =
        ids.get(slot.allowed_component) ??
        resolveComponentIds([slot.allowed_component], existingIds).get(slot.allowed_component)!;
      if (slot.allowed_component !== id) updateSlot.run(id, slot.rowid);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
