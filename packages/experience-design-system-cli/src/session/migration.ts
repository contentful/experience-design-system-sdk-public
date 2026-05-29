import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { generateSessionId } from './session-id.js';

const MIGRATION_NAME = 'v1_import_and_reviews';

export function getReviewsDir(): string {
  if (process.env.EDS_REVIEW_ARTIFACTS_DIR) {
    return resolve(process.env.EDS_REVIEW_ARTIFACTS_DIR);
  }
  return resolve(homedir(), '.contentful', 'experience-design-system-cli', 'reviews');
}

export function getLegacyImportDbPath(): string {
  if (process.env.EDS_IMPORT_DB_PATH) {
    return resolve(process.env.EDS_IMPORT_DB_PATH);
  }
  return resolve(homedir(), '.contentful', 'experience-design-system-cli', 'import.db');
}

export function runMigrationIfNeeded(db: DatabaseSync): void {
  const alreadyRan = db.prepare('SELECT name FROM migrations WHERE name = ?').get(MIGRATION_NAME) as
    | { name: string }
    | undefined;
  if (alreadyRan) return;

  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    migrateReviewSessions(db, now);
    migrateImportDb(db, now);
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(MIGRATION_NAME, now);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    process.stderr.write(
      `Warning: pipeline session migration failed — continuing without migrated data.\n${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
}

function migrateReviewSessions(db: DatabaseSync, _now: string): void {
  const reviewsDir = getReviewsDir();

  let entries: string[];
  try {
    entries = readdirSync(reviewsDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.endsWith('.migrated')) continue;
    const sessionDir = join(reviewsDir, entry);

    try {
      if (!statSync(sessionDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const stateFile = join(sessionDir, 'current-review-state.json');
    let snapshot: {
      inputPath?: string;
      components?: Array<{
        id: string;
        name: string;
        status: string;
        originalProposal: unknown;
        editedProposal: unknown;
        resolvedSourcePath?: string;
      }>;
    };

    try {
      snapshot = JSON.parse(readFileSync(stateFile, 'utf8')) as typeof snapshot;
    } catch {
      process.stderr.write(`Warning: skipping migration of review session ${entry} — cannot read state file.\n`);
      continue;
    }

    const sessionId = generateSessionId();
    const mtime = statSync(stateFile).mtime.toISOString();

    db.prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, NULL, ?, ?)').run(
      sessionId,
      mtime,
      mtime,
    );

    db.prepare(
      `INSERT INTO steps (session_id, command, status, started_at, completed_at, inputs, outputs, updated_at)
       VALUES (?, 'generate refine', 'interrupted', ?, ?, ?, '{}', ?)`,
    ).run(sessionId, mtime, mtime, JSON.stringify({ rawComponents: snapshot.inputPath ?? '' }), mtime);

    try {
      renameSync(sessionDir, `${sessionDir}.migrated`);
    } catch {
      // non-fatal
    }
  }
}

function migrateImportDb(db: DatabaseSync, _now: string): void {
  const importDbPath = getLegacyImportDbPath();

  if (!existsSync(importDbPath)) return;

  let importDb: DatabaseSync;
  try {
    importDb = new DatabaseSync(importDbPath, { readOnly: true } as never);
  } catch {
    return;
  }

  try {
    const importSessions = importDb
      .prepare('SELECT space_id, environment_id, started_at, updated_at FROM sessions')
      .all() as Array<{
      space_id: string;
      environment_id: string;
      started_at: string;
      updated_at: string;
    }>;

    for (const s of importSessions) {
      const sessionId = generateSessionId();
      const sessionName = `import:${s.space_id}:${s.environment_id}`;

      db.prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        sessionId,
        sessionName,
        s.started_at,
        s.updated_at,
      );

      // import_items is no longer in the pipeline schema — legacy push history is not migrated
    }

    importDb.close();

    try {
      renameSync(importDbPath, `${importDbPath}.migrated`);
    } catch {
      // non-fatal
    }
  } catch (e) {
    try {
      importDb.close();
    } catch {
      // ignore
    }
    throw e;
  }
}
