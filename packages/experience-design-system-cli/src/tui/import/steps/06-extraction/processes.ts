import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { findLegacyCliPath } from '../../../../legacy/legacy-cli-path.js';
import { parsePrintTokensCount } from './logic.js';

/** The legacy commands the stage drives, started the way the wizard starts them. */
export interface SpawnedResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface TokenGenerationInput {
  rawTokensPath: string;
  outDir: string;
  agent: string;
  agentModel?: string;
  promptOverrides: string[];
  noCache: boolean;
}

export type TokenGenerationResult =
  | { ok: true; tokensPath: string; tokenSessionId: string | null; tokenCount: number }
  | { ok: false; step: 'generate tokens' | 'print tokens'; message: string };

const SESSION = /^session=(.+)$/;

/** The first `session=<id>` anywhere in a command's stdout. */
function findSession(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const match = SESSION.exec(line.trim());
    const id = match?.[1]?.trim();
    if (id) return id;
  }
  return null;
}

/** Arguments for `__generate tokens`, in the order the wizard passes them. */
export function buildGenerateTokensArgs(input: TokenGenerationInput): string[] {
  const args = ['__generate', 'tokens', '--agent', input.agent, '--raw-tokens', input.rawTokensPath];
  if (input.agentModel) args.push('--model', input.agentModel);
  if (input.noCache) args.push('--no-cache');
  for (const prompt of input.promptOverrides) args.push('--prompt', prompt);
  return args;
}

/** Arguments for `print tokens`, which writes the generated catalog next to the project. */
export function buildPrintTokensArgs(tokensPath: string, tokenSessionId: string | null): string[] {
  return ['print', 'tokens', '--out', tokensPath, ...(tokenSessionId ? ['--session', tokenSessionId] : [])];
}

function runBuffered(args: string[]): Promise<SpawnedResult> {
  return new Promise((resolve) => {
    execFile('node', [findLegacyCliPath(), ...args], (error, stdout, stderr) => {
      resolve({ exitCode: error?.code ? Number(error.code) : 0, stdout, stderr });
    });
  });
}

/** `__generate tokens`, then `print tokens` to write `<outDir>/tokens.json`. */
export async function runTokenGeneration(input: TokenGenerationInput): Promise<TokenGenerationResult> {
  const generated = await runBuffered(buildGenerateTokensArgs(input));
  if (generated.exitCode !== 0) {
    return { ok: false, step: 'generate tokens', message: generated.stderr.trim() || 'Unknown error' };
  }
  const tokenSessionId = findSession(generated.stdout);

  const tokensPath = join(input.outDir, 'tokens.json');
  const printed = await runBuffered(buildPrintTokensArgs(tokensPath, tokenSessionId));
  if (printed.exitCode !== 0) {
    return { ok: false, step: 'print tokens', message: printed.stderr.trim() || 'Unknown error' };
  }
  return { ok: true, tokensPath, tokenSessionId, tokenCount: parsePrintTokensCount(printed.stdout) };
}
