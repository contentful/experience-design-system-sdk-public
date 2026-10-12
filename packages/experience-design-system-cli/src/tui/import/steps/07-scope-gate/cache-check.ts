import { execFile } from 'node:child_process';
import { findLegacyCliPath } from '../../../../legacy/legacy-cli-path.js';

// The background generation cache check, run while the gate is on screen. It restores cached component definitions into
// the pipeline database and reports which components are already generated, so confirming the scope can go straight on.
//
// It runs the legacy `generate components --cache-status --restore-cache` command, the same one the wizard runs today
// (the wizard still re-runs it after saving the decisions when this result is not a full hit). Because
// `--restore-cache` writes to the same database as the decisions do, the flow awaits this before launching the wizard,
// which keeps the order the wizard relied on: cache restore first, decisions second.
//
// A failed check is indistinguishable from "nothing cached", as in legacy. INTEG-5050 tracks surfacing it.

export interface CacheCheckInput {
  sessionId: string;
  tokensPath: string;
  agent: string;
  agentModel?: string;
  promptOverrides: string[];
  existingEntitiesPath: string | null;
  noCache: boolean;
}

interface CacheCheckProcess {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs the legacy CLI with these arguments and waits for it to exit. */
export type RunLegacyCli = (args: string[]) => Promise<CacheCheckProcess>;

/**
 * The arguments of `generate components --cache-status --restore-cache`, in the order the wizard built them: the
 * generate arguments first, then the two cache flags. Arguments are not shell-quoted; they go straight to `node`.
 */
export function buildCacheCheckArgs(input: CacheCheckInput): string[] {
  const args = ['__generate', 'components', '--agent', input.agent, '--session', input.sessionId];
  if (input.tokensPath) args.push('--tokens', input.tokensPath);
  if (input.agentModel) args.push('--model', input.agentModel);
  if (input.noCache) args.push('--no-cache');
  for (const prompt of input.promptOverrides) args.push('--prompt', prompt);
  if (input.existingEntitiesPath) args.push('--existing-entities-path', input.existingEntitiesPath);
  args.push('--cache-status', '--restore-cache');
  return args;
}

/** The names on the `cache-components=["A","B"]` line. Anything missing or unreadable is an empty list. */
export function parseCacheComponents(stdout: string): string[] {
  const line = /^cache-components=(.+)$/m.exec(stdout)?.[1];
  if (!line) return [];
  try {
    const names: unknown = JSON.parse(line);
    return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

const runLegacyCli: RunLegacyCli = (args) =>
  new Promise((resolve) => {
    execFile('node', [findLegacyCliPath(), ...args], (error, stdout, stderr) => {
      resolve({ exitCode: error?.code ? Number(error.code) : 0, stdout, stderr });
    });
  });

/**
 * Never throws: any failure (spawn error, non-zero exit, no output line, bad JSON) resolves to an empty list. With the
 * cache off there is nothing to restore, so the command is not run at all.
 */
export async function checkGenerationCache(
  input: CacheCheckInput,
  run: RunLegacyCli = runLegacyCli,
): Promise<string[]> {
  if (input.noCache) return [];
  try {
    const result = await run(buildCacheCheckArgs(input));
    if (result.exitCode !== 0) return [];
    return parseCacheComponents(result.stdout);
  } catch {
    return [];
  }
}
