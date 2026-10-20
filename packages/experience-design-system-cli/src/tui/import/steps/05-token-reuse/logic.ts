import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

// What the import does with the generated token catalog (`tokens.json` in an import run's `dsi-import-N` folder): reuse keeps the file,
// regenerate rebuilds it with the cache off, and generate builds it the normal way (cache allowed) when there was
// nothing to ask about. The legacy wizard receives the choice in the import handoff.
export type { TokenStrategy } from '../06-extraction/types.js';

export type TokensState = { kind: 'none' } | { kind: 'cached'; tokensPath: string; sourceChanged: boolean };

interface InspectInput {
  rawTokensPath: string;
  /** The `.contentful` folder: the sessions' `dsi-import` folders sit inside it, and an older `tokens.json` may sit in it. */
  contentfulDir: string;
  cache: boolean;
}

// The newest tokens.json from an earlier import. Each import run keeps its own in <session>/dsi-import-N, and the
// catalog from before sessions existed sits directly in the .contentful folder.
async function findLatestTokens(contentfulDir: string): Promise<string | null> {
  const candidates = [join(contentfulDir, 'tokens.json')];
  try {
    for (const session of await readdir(contentfulDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue;
      for (const run of await readdir(join(contentfulDir, session.name), { withFileTypes: true }).catch(() => [])) {
        if (run.isDirectory() && /^dsi-import-\d+$/.test(run.name)) {
          candidates.push(join(contentfulDir, session.name, run.name, 'tokens.json'));
        }
      }
    }
  } catch {
    // no .contentful folder yet: nothing to reuse
  }
  const found: Array<{ path: string; mtimeMs: number }> = [];
  for (const path of candidates) {
    try {
      found.push({ path, mtimeMs: (await stat(path)).mtimeMs });
    } catch {
      // not there
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path ?? null;
}

export async function inspectTokens({ rawTokensPath, contentfulDir, cache }: InspectInput): Promise<TokensState> {
  if (!cache) return { kind: 'none' };

  const tokensPath = await findLatestTokens(contentfulDir);
  if (!tokensPath) return { kind: 'none' };
  try {
    await access(tokensPath);
  } catch {
    return { kind: 'none' };
  }

  const [generated, source] = await Promise.all([stat(tokensPath), stat(rawTokensPath).catch(() => null)]);
  return { kind: 'cached', tokensPath, sourceChanged: source ? source.mtimeMs > generated.mtimeMs : false };
}
