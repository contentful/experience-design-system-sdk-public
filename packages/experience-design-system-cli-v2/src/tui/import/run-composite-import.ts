import { spawn } from 'node:child_process';
import { findLegacyCliPath } from './legacy-cli-path.js';

interface StepResult {
  step: string;
  status: 'complete' | 'failed' | 'skipped';
  durationMs?: number;
  reason?: string;
  detail?: Record<string, unknown>;
  error?: string;
}

export interface PipelineResult {
  session: string;
  project: string;
  steps: StepResult[];
  cycleError?: { report: string[] };
}

export interface RunCompositeImportOptions {
  project?: string;
  onProgress?: (line: string) => void;
}

export interface RunCompositeImportResult {
  exitCode: number;
  result?: PipelineResult;
  stdout: string;
  stderr: string;
}

function buildArgs(options: RunCompositeImportOptions): string[] {
  // Generate only, never push in this ticket — credentials (when supplied) only
  // unlock the fetch-existing-entities step, which orchestrator.ts gates on
  // spaceId/environmentId/cmaToken independently of --no-push.
  const args = ['import'];

  if (options.project) {
    args.push('--project', options.project);
  }

  return args;
}

export async function runCompositeImport(options: RunCompositeImportOptions = {}): Promise<RunCompositeImportResult> {
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
