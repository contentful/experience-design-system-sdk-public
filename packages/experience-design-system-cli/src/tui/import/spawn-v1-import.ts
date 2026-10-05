import { spawn } from 'node:child_process';
import { findLegacyCliPath } from '../../legacy/legacy-cli-path.js';

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

export interface SpawnV1ImportOptions {
  project?: string;
  onProgress?: (line: string) => void;
}

export interface SpawnV1ImportResult {
  exitCode: number;
  result?: PipelineResult;
  stdout: string;
  stderr: string;
}

function buildArgs(options: SpawnV1ImportOptions): string[] {
  const args = ['import'];

  if (options.project) {
    args.push('--project', options.project);
  }

  return args;
}

export async function spawnV1Import(options: SpawnV1ImportOptions = {}): Promise<SpawnV1ImportResult> {
  const cliPath = findLegacyCliPath();
  const args = buildArgs(options);

  return new Promise((resolvePromise) => {
    const child = spawn('node', [cliPath, ...args], {
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      resolvePromise({ exitCode: code ?? 1, result: undefined, stdout: '', stderr: '' });
    });

    child.on('error', (err) => {
      resolvePromise({ exitCode: 1, result: undefined, stdout: '', stderr: err.message });
    });
  });
}
