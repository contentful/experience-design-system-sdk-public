import type { DatabaseSync } from 'node:sqlite';
import type { SelectionDecision } from '../types/contract.js';

export function lookupSelectionCache(
  db: DatabaseSync,
  componentHash: string,
  promptHash: string,
  cliVersion: string,
): SelectionDecision | null {
  const row = db
    .prepare(
      'SELECT decision, reason FROM selection_cache WHERE component_hash = ? AND prompt_hash = ? AND cli_version = ?',
    )
    .get(componentHash, promptHash, cliVersion) as
    | { decision: 'accepted' | 'rejected'; reason: string | null }
    | undefined;
  if (!row) return null;
  return { decision: row.decision, reason: row.reason };
}

export function storeSelectionCache(
  db: DatabaseSync,
  componentHash: string,
  promptHash: string,
  cliVersion: string,
  decision: 'accepted' | 'rejected',
  reason: string | null,
): void {
  db.prepare(
    'INSERT OR REPLACE INTO selection_cache (component_hash, prompt_hash, cli_version, decision, reason) VALUES (?, ?, ?, ?, ?)',
  ).run(componentHash, promptHash, cliVersion, decision, reason);
}
