import { spawn } from 'node:child_process';
import { findLegacyCliPath } from '../../legacy/legacy-cli-path.js';
import { importOptionArgs, type ImportOptions } from '../../commands/import-options.js';
import type { TokenStrategy } from './steps/05-token-reuse/logic.js';

interface StepResult {
  step: string;
  status: 'complete' | 'failed' | 'skipped';
  durationMs?: number;
  reason?: string;
  detail?: Record<string, unknown>;
  error?: string;
}

interface PipelineResult {
  session: string;
  project: string;
  steps: StepResult[];
  cycleError?: { report: string[] };
}

export interface SpawnV1ImportOptions extends Partial<ImportOptions> {
  projectPath?: string;
  tokens?: string;
  filePaths?: string[];
  skipCredentials?: boolean;
  tokenStrategy?: TokenStrategy;
  onProgress?: (line: string) => void;
}

export interface SpawnV1ImportResult {
  exitCode: number;
  result?: PipelineResult;
  stdout: string;
  stderr: string;
}

export function buildArgs(options: SpawnV1ImportOptions): string[] {
  const args = ['import'];

  if (options.projectPath) {
    args.push('--project', options.projectPath);
  }

  if (options.tokens) {
    args.push('--tokens', options.tokens);
  }

  args.push(...importOptionArgs({ agent: options.agent, prompt: options.prompt ?? [], cache: options.cache ?? true }));

  return args;
}

// The answers v2 already collected, handed to the legacy wizard as environment variables.
export function buildEnv(options: SpawnV1ImportOptions, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    ...(options.skipCredentials ? { EDS_IMPORT_SKIP_CREDENTIALS: '1' } : {}),
    ...(options.tokenStrategy ? { EDS_IMPORT_TOKENS: options.tokenStrategy } : {}),
  };
}

export async function spawnV1Import(options: SpawnV1ImportOptions = {}): Promise<SpawnV1ImportResult> {
  const cliPath = findLegacyCliPath();
  const args = buildArgs(options);

  return new Promise((resolvePromise) => {
    const child = spawn('node', [cliPath, ...args], {
      stdio: 'inherit',
      env: buildEnv(options),
    });

    child.on('close', (code) => {
      resolvePromise({ exitCode: code ?? 1, result: undefined, stdout: '', stderr: '' });
    });

    child.on('error', (err) => {
      resolvePromise({ exitCode: 1, result: undefined, stdout: '', stderr: err.message });
    });
  });
}
