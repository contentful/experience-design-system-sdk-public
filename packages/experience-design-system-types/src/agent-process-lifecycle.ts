import type { ChildProcess } from 'node:child_process';

export interface AgentProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface AgentProcessEndDetails {
  result: AgentProcessResult;
  signal: NodeJS.Signals | null;
  durationMs: number;
}

export interface RunAgentProcessOptions {
  spawn: () => ChildProcess;
  timeoutMs: number;
  signal?: AbortSignal;
  stdinText?: string;
  onOutput?: (chunk: string) => void;
  onStart?: () => void;
  onEnd?: (details: AgentProcessEndDetails) => void;
}

export function createAgentCancellationResult(): AgentProcessResult {
  return {
    exitCode: 1,
    stdout: '',
    stderr: 'Agent invocation was cancelled.',
    timedOut: false,
  };
}

/** Owns the shared child-process timeout, abort, output and cleanup policy. */
export function runAgentProcess(options: RunAgentProcessOptions): Promise<AgentProcessResult> {
  const { signal, timeoutMs, onOutput } = options;
  if (signal?.aborted) {
    return Promise.resolve(createAgentCancellationResult());
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let child: ChildProcess;
    options.onStart?.();
    try {
      child = options.spawn();
    } catch (error) {
      const result: AgentProcessResult = {
        exitCode: 1,
        stdout: '',
        stderr: errorMessage(error),
        timedOut: false,
      };
      options.onEnd?.({ result, signal: null, durationMs: Date.now() - startedAt });
      resolve(result);
      return;
    }

    let stdout = '';
    let stderr = '';
    let stopReason: 'abort' | 'timeout' | undefined;
    let timer: NodeJS.Timeout | undefined;
    let stdinEnded = false;
    let settled = false;

    const appendError = (error: unknown) => {
      const message = errorMessage(error);
      if (!message || stderr.includes(message)) return;
      stderr += `${stderr && !stderr.endsWith('\n') ? '\n' : ''}${message}`;
    };

    const endStdin = () => {
      if (stdinEnded) return;
      stdinEnded = true;
      try {
        child.stdin?.end();
      } catch (error) {
        appendError(error);
      }
    };

    const onStdinError = (error: Error) => appendError(error);
    const onStdoutError = (error: Error) => appendError(error);
    const onStderrError = (error: Error) => appendError(error);
    const onStdoutData = (chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      stdout += text;
      if (!signal?.aborted && !settled) onOutput?.(text);
    };
    const onStderrData = (chunk: Buffer | string) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
    };
    const onChildError = (error: Error) => appendError(error);

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      child.removeListener('error', onChildError);
      child.removeListener('close', onClose);
      child.stdin?.removeListener('error', onStdinError);
      child.stdout?.removeListener('error', onStdoutError);
      child.stdout?.removeListener('data', onStdoutData);
      child.stderr?.removeListener('error', onStderrError);
      child.stderr?.removeListener('data', onStderrData);
    };

    const requestStop = (reason: 'abort' | 'timeout') => {
      if (settled || stopReason) return;
      stopReason = reason;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      endStdin();
      try {
        child.kill('SIGTERM');
      } catch (error) {
        appendError(error);
      }
    };

    const onAbort = () => requestStop('abort');
    const onClose = (code: number | null, childSignal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      endStdin();
      cleanup();
      const result: AgentProcessResult = {
        exitCode: stopReason ? 1 : childSignal ? 1 : (code ?? 1),
        stdout,
        stderr,
        timedOut: stopReason === 'timeout',
      };
      options.onEnd?.({ result, signal: childSignal, durationMs: Date.now() - startedAt });
      resolve(result);
    };

    child.stdin?.on('error', onStdinError);
    child.stdout?.on('error', onStdoutError);
    child.stdout?.on('data', onStdoutData);
    child.stderr?.on('error', onStderrError);
    child.stderr?.on('data', onStderrData);
    child.on('error', onChildError);
    child.on('close', onClose);

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }

    if (!stopReason) {
      timer = setTimeout(() => requestStop('timeout'), timeoutMs);
      if (options.stdinText !== undefined && child.stdin) {
        try {
          child.stdin.write(options.stdinText, (error) => {
            if (error) appendError(error);
            endStdin();
          });
        } catch (error) {
          appendError(error);
          endStdin();
        }
      } else {
        endStdin();
      }
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
