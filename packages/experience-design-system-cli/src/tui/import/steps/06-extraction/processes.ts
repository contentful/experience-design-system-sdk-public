import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { findLegacyCliPath } from '../../../../legacy/legacy-cli-path.js';
import { findSession, parsePrintTokensCount } from './logic.js';

/** The legacy commands the stage drives, started the way the wizard starts them. */
export interface SpawnedResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExtractCommand {
  projectPath: string;
  agent: string;
  promptOverrides: string[];
  noCache: boolean;
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

/** Splits a stream into lines as chunks arrive, holding back a trailing partial line until the next chunk completes it. */
export function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  };
}

/** Arguments for `__extract`, in the order the wizard passes them. The extract command takes an agent but no model. */
export function buildExtractArgs(cliPath: string, command: ExtractCommand): string[] {
  const args = [cliPath, '__extract', '--project', command.projectPath];
  if (command.noCache) args.push('--composition-refresh', '--no-cache');
  for (const prompt of command.promptOverrides) args.push('--prompt', prompt);
  if (command.agent) args.push('--agent', command.agent);
  return args;
}

/** Arguments for `__generate tokens`, in the order the wizard passes them. */
export function buildGenerateTokensArgs(cliPath: string, input: TokenGenerationInput): string[] {
  const args = [cliPath, '__generate', 'tokens', '--agent', input.agent, '--raw-tokens', input.rawTokensPath];
  if (input.agentModel) args.push('--model', input.agentModel);
  if (input.noCache) args.push('--no-cache');
  for (const prompt of input.promptOverrides) args.push('--prompt', prompt);
  return args;
}

/** Arguments for `print tokens`, which writes the generated catalog next to the project. */
export function buildPrintTokensArgs(tokensPath: string, tokenSessionId: string | null): string[] {
  return ['print', 'tokens', '--out', tokensPath, ...(tokenSessionId ? ['--session', tokenSessionId] : [])];
}

function run(
  args: string[],
  handlers: { onStderrLine?: (line: string) => void; onStdoutLine?: (line: string) => void } = {},
): Promise<SpawnedResult> {
  return new Promise((resolve) => {
    const child = spawn('node', args);
    let stdout = '';
    let stderr = '';
    const stderrLines = lineSplitter((line) => handlers.onStderrLine?.(line));
    const stdoutLines = lineSplitter((line) => handlers.onStdoutLine?.(line));

    child.stdout.on('data', (data: Buffer) => {
      const chunk = String(data);
      stdout += chunk;
      stdoutLines(chunk);
    });
    child.stderr.on('data', (data: Buffer) => {
      const chunk = String(data);
      stderr += chunk;
      stderrLines(chunk);
    });
    child.on('error', (error) => resolve({ exitCode: 1, stdout, stderr: stderr || error.message }));
    child.on('exit', (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
  });
}

/** `node <legacy cli> __extract …`, with stderr and stdout delivered line by line while it runs. */
export function spawnExtract(
  command: ExtractCommand,
  handlers: { onStderrLine: (line: string) => void; onStdoutLine: (line: string) => void },
): Promise<SpawnedResult> {
  return run(buildExtractArgs(findLegacyCliPath(), command), handlers);
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
  const generated = await run(buildGenerateTokensArgs(findLegacyCliPath(), input));
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
