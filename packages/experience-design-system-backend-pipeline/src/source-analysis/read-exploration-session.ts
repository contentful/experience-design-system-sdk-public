import { DatabaseSync } from 'node:sqlite';
import { loadCompletedSourceEvidence, loadRawComponents } from '../persistence/src/session/repositories/db.js';
import type { SourceAnalysisTasks } from './types.js';

/** Read a consistent snapshot without initializing, repairing or writing the session database. */
export function readExplorationSession(
  input: SourceAnalysisTasks['loadSession']['input'],
): SourceAnalysisTasks['loadSession']['output'] {
  const db = new DatabaseSync(input.dbPath, { readOnly: true });
  try {
    db.exec('BEGIN');
    try {
      const saved = loadCompletedSourceEvidence(db, input.sessionId, input.handle);
      return { saved, raw: saved.readiness === 'ready' ? loadRawComponents(db, input.sessionId) : [] };
    } finally {
      db.exec('ROLLBACK');
    }
  } finally {
    db.close();
  }
}
