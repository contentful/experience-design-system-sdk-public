import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { loadDTCGTokens } from '../../../persistence/src/session/repositories/db.js';
import { rebuildDTCGTree } from '../../../steps/shared/dtcg/helpers/rebuild-dtcg-tree.js';
import type { RunGenerateTokensSessionRequest } from '../types.js';

export async function writeTokensFile(
  db: DatabaseSync,
  sessionId: string,
  outDir: string,
  onProgress: RunGenerateTokensSessionRequest['onProgress'],
): Promise<{ tokensPath: string; tokenCount: number }> {
  onProgress?.({ kind: 'writing-file' });
  const result = loadDTCGTokens(db, sessionId);
  if (result.tokens.length === 0) {
    throw new Error(`generate tokens: no tokens persisted for session ${sessionId}`);
  }
  const tree = rebuildDTCGTree(result.groups, result.tokens);
  const tokensPath = join(outDir, 'tokens.json');
  await mkdir(outDir, { recursive: true });
  await writeFile(tokensPath, `${JSON.stringify(tree, null, 2)}\n`);
  return { tokensPath, tokenCount: result.tokens.length };
}
