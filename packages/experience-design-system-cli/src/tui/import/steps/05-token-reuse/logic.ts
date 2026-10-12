import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';

// What the import does with the generated token catalog (`<project>/.contentful/tokens.json`): reuse keeps the file,
// regenerate rebuilds it with the cache off, and generate builds it the normal way (cache allowed) when there was
// nothing to ask about. The legacy wizard receives the choice in the import handoff.
export type { TokenStrategy } from '../06-extraction/types.js';

export type TokensState = { kind: 'none' } | { kind: 'cached'; tokensPath: string; sourceChanged: boolean };

interface InspectInput {
  rawTokensPath: string;
  outDir: string;
  cache: boolean;
}

export async function inspectTokens({ rawTokensPath, outDir, cache }: InspectInput): Promise<TokensState> {
  if (!cache) return { kind: 'none' };

  const tokensPath = join(outDir, 'tokens.json');
  try {
    await access(tokensPath);
  } catch {
    return { kind: 'none' };
  }

  const [generated, source] = await Promise.all([stat(tokensPath), stat(rawTokensPath).catch(() => null)]);
  return { kind: 'cached', tokensPath, sourceChanged: source ? source.mtimeMs > generated.mtimeMs : false };
}

export function gateText({ tokensPath, sourceChanged }: { tokensPath: string; sourceChanged: boolean }): {
  summary: string;
  context?: string;
} {
  const summary = sourceChanged
    ? `Source file has been modified since tokens were last generated.\n\nTokens Path: ${tokensPath}`
    : `Source file has not changed since tokens were last generated.\n\nTokens Path: ${tokensPath}`;
  return sourceChanged
    ? { summary, context: 'The source tokens file changed — regenerating is recommended.' }
    : { summary };
}
