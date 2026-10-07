import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { lookupCompositionCache, storeCompositionCache } from './cache/composition.js';
import { lookupGenerationCache, storeGenerationCache } from './cache/generation.js';
import { lookupSelectionCache, storeSelectionCache } from './cache/selection.js';
import { SCHEMA_SQL } from './schema.js';
import { generateSessionId } from './session-id.js';
import type { OpenSessionOptions, SessionHandle } from './types/contract.js';

export function openSession({ dbPath, sessionId, cliVersion }: OpenSessionOptions): SessionHandle {
  const resolvedPath = dbPath ?? path.join(process.env['HOME'] ?? '.', '.contentful', 'experience-design-system-cli', 'pipeline.db');
  const id = sessionId ?? generateSessionId();

  if (resolvedPath !== ':memory:') {
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA_SQL);

  db.prepare('INSERT OR IGNORE INTO sessions (id, cli_version) VALUES (?, ?)').run(id, cliVersion);

  return {
    id,
    composition: {
      lookup: (inputHash) => lookupCompositionCache(db, inputHash, cliVersion),
      store: (inputHash, agentOutput) => storeCompositionCache(db, inputHash, cliVersion, agentOutput),
    },
    selection: {
      lookup: (componentHash, promptHash) =>
        lookupSelectionCache(db, componentHash, promptHash, cliVersion),
      store: (componentHash, promptHash, decision, reason) =>
        storeSelectionCache(db, componentHash, promptHash, cliVersion, decision, reason),
    },
    generation: {
      lookup: (inputHash, promptHash) =>
        lookupGenerationCache(db, inputHash, promptHash, cliVersion),
      store: (inputHash, promptHash, entry) =>
        storeGenerationCache(db, inputHash, promptHash, cliVersion, entry),
    },
    close: () => db.close(),
  };
}
