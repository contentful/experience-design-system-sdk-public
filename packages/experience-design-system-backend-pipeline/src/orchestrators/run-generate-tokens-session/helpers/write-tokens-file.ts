import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { loadDTCGTokens } from '../../../persistence/src/session/repositories/db.js';
import { rebuildDTCGTree } from '../../../steps/shared/dtcg/helpers/rebuild-dtcg-tree.js';
import type { RunGenerateTokensSessionRequest } from '../types.js';
import { throwIfAborted } from '../../../helpers/abort.js';

export async function writeTokensFile(
  db: DatabaseSync,
  sessionId: string,
  outDir: string,
  onProgress: RunGenerateTokensSessionRequest['onProgress'],
  signal?: AbortSignal,
): Promise<{ tokensPath: string; tokenCount: number }> {
  throwIfAborted(signal);
  onProgress?.({ kind: 'writing-file' });
  const result = loadDTCGTokens(db, sessionId);
  throwIfAborted(signal);
  if (result.tokens.length === 0) {
    throw new Error(`generate tokens: no tokens persisted for session ${sessionId}`);
  }
  const tree = rebuildDTCGTree(result.groups, result.tokens);
  const tokensPath = join(outDir, 'tokens.json');
  throwIfAborted(signal);
  await mkdir(outDir, { recursive: true });
  throwIfAborted(signal);
  await writeFile(tokensPath, `${JSON.stringify(tree, null, 2)}\n`);
  throwIfAborted(signal);
  return { tokensPath, tokenCount: result.tokens.length };
}
