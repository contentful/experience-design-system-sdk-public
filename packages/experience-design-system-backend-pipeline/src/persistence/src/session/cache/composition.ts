import type { DatabaseSync } from 'node:sqlite';

export function lookupCompositionCache(db: DatabaseSync, inputHash: string, cliVersion: string): string | null {
  const row = db
    .prepare('SELECT agent_output FROM composition_cache WHERE input_hash = ? AND cli_version = ?')
    .get(inputHash, cliVersion) as { agent_output: string } | undefined;
  return row?.agent_output ?? null;
}

export function storeCompositionCache(
  db: DatabaseSync,
  inputHash: string,
  cliVersion: string,
  agentOutput: string,
): void {
  db.prepare('INSERT OR REPLACE INTO composition_cache (input_hash, cli_version, agent_output) VALUES (?, ?, ?)').run(
    inputHash,
    cliVersion,
    agentOutput,
  );
}
