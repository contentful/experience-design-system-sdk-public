import type { DatabaseSync } from 'node:sqlite';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

export function lookupGenerationCache(
  db: DatabaseSync,
  inputHash: string,
  promptHash: string,
  cliVersion: string,
): CDFComponentEntry | null {
  const row = db
    .prepare('SELECT cdf_json FROM generation_cache WHERE input_hash = ? AND prompt_hash = ? AND cli_version = ?')
    .get(inputHash, promptHash, cliVersion) as { cdf_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.cdf_json) as CDFComponentEntry;
}

export function storeGenerationCache(
  db: DatabaseSync,
  inputHash: string,
  promptHash: string,
  cliVersion: string,
  entry: CDFComponentEntry,
): void {
  db.prepare(
    'INSERT OR REPLACE INTO generation_cache (input_hash, prompt_hash, cli_version, cdf_json) VALUES (?, ?, ?, ?)',
  ).run(inputHash, promptHash, cliVersion, JSON.stringify(entry));
}
