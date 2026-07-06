/**
 * Extracted spawn helper for the `generate components` subprocess.
 *
 * Why this exists: the wizard now kicks off generation from TWO call sites —
 * the post-credentials path (`runGenerate`) AND a pre-fetch from scope-gate
 * confirm (Change 2 in the prefetch spec). Both need the same spawn-and-stream
 * behavior but the await-on-exit happens at different times. Keeping `runGenerate`
 * as a thin wrapper around this helper lets the pre-fetch path stash the
 * `donePromise` in a ref and resolve it later.
 *
 * Subprocess hygiene: we listen for 'close' (not 'exit') when surfacing the
 * final result so the child's stdio + any inherited file handles (e.g. the
 * pipeline SQLite WAL/SHM) have been fully released by the OS before the
 * wizard re-enters that path. This applies the same lesson as
 * fix/auto-filter-db-lock.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export type SpawnGenerateResult = {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

export type SpawnGenerateOpts = {
  command: string;
  args: string[];
  onStderr?: (chunk: string) => void;
  onStdout?: (chunk: string) => void;
};

export function spawnGenerateChild(opts: SpawnGenerateOpts): {
  child: ChildProcess;
  donePromise: Promise<SpawnGenerateResult>;
} {
  const child = spawn(opts.command, opts.args);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d: Buffer) => {
    const chunk = String(d);
    stdout += chunk;
    opts.onStdout?.(chunk);
  });
  child.stderr?.on('data', (d: Buffer) => {
    const chunk = String(d);
    stderr += chunk;
    opts.onStderr?.(chunk);
  });
  const donePromise = new Promise<SpawnGenerateResult>((resolve) => {
    // Use 'close' rather than 'exit' so stdio drains and any inherited file
    // handles are released before downstream code reacts.
    child.on('close', (code, signal) => {
      resolve({
        exitCode: code ?? 0,
        signal: signal ?? null,
        stdout,
        stderr,
      });
    });
    child.on('error', (err) => {
      resolve({
        exitCode: 1,
        signal: null,
        stdout,
        stderr: stderr + (err.message ?? String(err)),
      });
    });
  });
  return { child, donePromise };
}
