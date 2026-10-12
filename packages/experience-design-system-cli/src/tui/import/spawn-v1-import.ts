import { spawn } from 'node:child_process';
import { findLegacyCliPath } from '../../legacy/legacy-cli-path.js';
import { importOptionArgs, type ImportOptions } from '../../commands/import-options.js';
import { HANDOFF_ENV, serializeHandoff, type ImportHandoff } from '@contentful/experience-design-system-types/handoff';

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
  /** What the CLI already settled and did; the legacy wizard starts from it. */
  handoff?: ImportHandoff;
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

// The answers and results v2 already has, handed to the legacy wizard in one environment variable.
export function buildEnv(options: SpawnV1ImportOptions, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, ...(options.handoff ? { [HANDOFF_ENV]: serializeHandoff(options.handoff) } : {}) };
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
