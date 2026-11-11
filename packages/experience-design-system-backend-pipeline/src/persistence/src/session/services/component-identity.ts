import type { DatabaseSync } from 'node:sqlite';
import { resolveComponentIds } from '@contentful/experience-design-system-types';

export function loadCDFComponentIds(db: DatabaseSync, sessionId: string): Map<string, string> {
  const rows = db.prepare('SELECT name, cdf_id FROM raw_components WHERE session_id = ?').all(sessionId) as Array<{
    name: string;
    cdf_id: string | null;
  }>;
  return new Map(rows.map((row) => [row.name, row.cdf_id ?? row.name]));
}

/** Assign identities once, before concurrent generation can create cross-component references. */
export function assignCDFComponentIds(db: DatabaseSync, sessionId: string, existingIds: readonly string[]): void {
  const pending = db
    .prepare('SELECT 1 FROM raw_components WHERE session_id = ? AND cdf_id IS NULL LIMIT 1')
    .get(sessionId);
  if (!pending) return;
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR IGNORE INTO session_component_identity (session_id, existing_ids) VALUES (?, ?)').run(
      sessionId,
      JSON.stringify(existingIds),
    );
    const saved = db
      .prepare('SELECT existing_ids FROM session_component_identity WHERE session_id = ?')
      .get(sessionId) as { existing_ids: string };
    const ids = resolveComponentIds(
      [...loadCDFComponentIds(db, sessionId).keys()],
      JSON.parse(saved.existing_ids) as string[],
    );
    const update = db.prepare(
      'UPDATE raw_components SET cdf_id = ? WHERE session_id = ? AND name = ? AND cdf_id IS NULL',
    );
    for (const [name, id] of ids) update.run(id, sessionId, name);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Persist the canonical reference when generation or review writes a slot, never during preview. */
export function persistCDFSlotIds(db: DatabaseSync, sessionId: string): void {
  const saved = db
    .prepare('SELECT existing_ids FROM session_component_identity WHERE session_id = ?')
    .get(sessionId) as { existing_ids: string } | undefined;
  if (!saved) return;
  const existingIds = JSON.parse(saved.existing_ids) as string[];
  const componentIds = loadCDFComponentIds(db, sessionId);
  const rows = db
    .prepare(
      `SELECT a.rowid AS row_id, a.allowed_component
    FROM raw_slot_allowed_components a
    JOIN raw_components c ON c.session_id = a.session_id AND c.component_id = a.component_id
    WHERE a.session_id = ? AND a.cdf_id IS NULL AND c.status = 'generated'`,
    )
    .all(sessionId) as Array<{
    row_id: number;
    allowed_component: string;
  }>;
  const update = db.prepare('UPDATE raw_slot_allowed_components SET cdf_id = ? WHERE rowid = ?');
  for (const row of rows) {
    const id =
      componentIds.get(row.allowed_component) ??
      resolveComponentIds([row.allowed_component], existingIds).get(row.allowed_component)!;
    update.run(id, row.row_id);
  }
}
