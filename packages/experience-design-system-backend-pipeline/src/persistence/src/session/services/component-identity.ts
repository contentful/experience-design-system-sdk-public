import { readGenerationReviewDraft } from '../repositories/generation-review-drafts.js';
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
  const components = db
    .prepare('SELECT name, component_id, cdf_schema FROM raw_components WHERE session_id = ?')
    .all(sessionId) as {
    name: string;
    component_id: string;
    cdf_schema: string | null;
  }[];
  const ids = resolveComponentIds(
    components.map((c) => c.name),
    existingIds,
  );
  const resolveReference = (name: string): string =>
    ids.get(name) ?? resolveComponentIds([name], existingIds).get(name)!;
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
    for (const component of components) {
      const draft = readGenerationReviewDraft(component.cdf_schema);
      if (!draft) continue;
      for (const slot of Object.values(draft.entry.$slots ?? {})) {
        if (Array.isArray(slot.$allowedComponents))
          slot.$allowedComponents = slot.$allowedComponents.map((name) =>
            typeof name === 'string' ? resolveReference(name) : name,
          );
      }
      if (draft.allowedComponentNames) draft.allowedComponentNames = draft.allowedComponentNames.map(resolveReference);
      db.prepare('UPDATE raw_components SET cdf_schema = ? WHERE session_id = ? AND component_id = ?').run(
        JSON.stringify(draft),
        sessionId,
        component.component_id,
      );
    }
    for (const slot of slots) {
      const id = resolveReference(slot.allowed_component);
      if (slot.allowed_component !== id) updateSlot.run(id, slot.rowid);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
