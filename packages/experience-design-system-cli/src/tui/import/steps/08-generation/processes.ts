import { execFile, spawn } from 'node:child_process';
import { findLegacyCliPath } from '../../../../legacy/legacy-cli-path.js';

// The legacy commands this stage drives, started the way the wizard starts them. Both stay legacy subprocesses.

export interface GenerateCommand {
  sessionId: string;
  tokensPath: string;
  agent: string;
  agentModel?: string;
  promptOverrides: string[];
  generatePromptPath?: string;
  noCache: boolean;
  existingEntitiesPath: string | null;
  /** Accepted components the cache already holds, so the command skips them. */
  cachedComponents: string[];
}

export interface MapTokensCommand {
  sessionId: string;
  agent: string;
  agentModel?: string;
  promptOverrides: string[];
  noCache: boolean;
  existingEntitiesPath: string | null;
}

export interface SpawnedResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * `__generate components …`, in the order the wizard builds the arguments. The cache was already restored by the check
 * that ran while the scope gate was open, so `--restore-cache` is not passed here; what the cache holds goes in
 * `--cached-components` instead.
 */
export function buildGenerateArgs(cliPath: string, command: GenerateCommand): string[] {
  const args = [cliPath, '__generate', 'components', '--agent', command.agent, '--session', command.sessionId];
  if (command.tokensPath) args.push('--tokens', command.tokensPath);
  if (command.agentModel) args.push('--model', command.agentModel);
  if (command.noCache) args.push('--no-cache');
  if (command.generatePromptPath) args.push('--generate-prompt-path', command.generatePromptPath);
  for (const prompt of command.promptOverrides) args.push('--prompt', prompt);
  if (command.existingEntitiesPath) args.push('--existing-entities-path', command.existingEntitiesPath);
  if (command.cachedComponents.length > 0) args.push('--cached-components', JSON.stringify(command.cachedComponents));
  return args;
}

/** `map tokens …`, in the order the wizard builds the arguments. */
export function buildMapTokensArgs(command: MapTokensCommand): string[] {
  const args = ['map', 'tokens', '--session', command.sessionId, '--agent', command.agent];
  if (command.agentModel) args.push('--model', command.agentModel);
  if (command.noCache) args.push('--no-cache');
  for (const prompt of command.promptOverrides) args.push('--prompt', prompt);
  if (command.existingEntitiesPath) args.push('--existing-entities-path', command.existingEntitiesPath);
  return args;
}

/**
 * Runs `__generate components`, delivering stderr as it arrives. Resolves on close, not exit, so the child's stdio and
 * any file handles it inherited (the pipeline database's WAL and SHM files) are released before anything else touches
 * the database.
 */
export function spawnGenerate(
  command: GenerateCommand,
  handlers: { onStderr: (chunk: string) => void },
): Promise<SpawnedResult> {
  return new Promise((resolve) => {
    const child = spawn('node', buildGenerateArgs(findLegacyCliPath(), command));
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += String(data);
    });
    child.stderr.on('data', (data: Buffer) => {
      const chunk = String(data);
      stderr += chunk;
      handlers.onStderr(chunk);
    });
    child.on('error', (error) => resolve({ exitCode: 1, stdout, stderr: stderr + error.message }));
    child.on('close', (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
  });
}

export function runMapTokens(command: MapTokensCommand): Promise<SpawnedResult> {
  return new Promise((resolve) => {
    execFile('node', [findLegacyCliPath(), ...buildMapTokensArgs(command)], (error, stdout, stderr) => {
      resolve({ exitCode: error?.code ? Number(error.code) : 0, stdout, stderr });
    });
  });
}
