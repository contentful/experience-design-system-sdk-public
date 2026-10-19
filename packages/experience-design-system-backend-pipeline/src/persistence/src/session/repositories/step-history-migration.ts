import type { DatabaseSync } from 'node:sqlite';

const MIGRATION_NAME = 'prune_obsolete_incomplete_step_commands_v1';
const OBSOLETE_COMMANDS = ['analyze select', 'print components', 'print tokens', 'fetch existing entities'] as const;
const INCOMPLETE_STATUSES = ['pending', 'failed', 'interrupted'] as const;

export function pruneObsoleteIncompleteStepsIfNeeded(db: DatabaseSync): void {
  const migration = db.prepare('SELECT name FROM migrations WHERE name = ?');
  if (migration.get(MIGRATION_NAME)) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    const alreadyApplied = migration.get(MIGRATION_NAME);
    if (alreadyApplied) {
      db.exec('COMMIT');
      return;
    }

    db.prepare(
      `DELETE FROM steps
       WHERE command IN (?, ?, ?, ?)
       AND status IN (?, ?, ?)`,
    ).run(...OBSOLETE_COMMANDS, ...INCOMPLETE_STATUSES);
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(MIGRATION_NAME, new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Step-history cleanup failed and its transaction did not roll back',
      );
    }

    process.stderr.write(
      `Warning: pipeline step-history cleanup failed — continuing without pruning history.\n${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
