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

interface CompositeImportCredentials {
  spaceId: string;
  environmentId: string;
  cmaToken: string;
}

export interface RunCompositeImportOptions {
  project?: string;
  credentials?: CompositeImportCredentials;
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
  const args = ['import', '--composite', '--yes', '--no-push'];

  if (options.credentials) {
    args.push('--space-id', options.credentials.spaceId);
    args.push('--environment-id', options.credentials.environmentId);
    args.push('--cma-token', options.credentials.cmaToken);
  }

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
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stderrBuffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (!options.onProgress) return;
      stderrBuffer += text;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length > 0) options.onProgress(line);
      }
    });

    child.on('close', (code) => {
      if (stderrBuffer.length > 0) options.onProgress?.(stderrBuffer);

      let result: PipelineResult | undefined;
      try {
        result = JSON.parse(stdout) as PipelineResult;
      } catch {
        result = undefined;
      }

      resolvePromise({ exitCode: code ?? 1, result, stdout, stderr });
    });
  });
}
