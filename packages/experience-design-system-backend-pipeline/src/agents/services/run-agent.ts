import { spawn } from 'node:child_process';
import { BEDROCK_ENV_BY_AGENT } from '../constants/bedrock.js';
import { buildArgs } from '../helpers/build-agent-args.js';
import { resolveBinary } from '../helpers/resolution/resolve-binary.js';
import type { AgentDebugEvent, AgentRunResult } from '../types/agent-run.js';
import type { AgentName } from '../types/agent-name.js';

export interface RunAgentOptions {
  agent: AgentName;
  prompt: string;
  timeoutMs: number;
  model?: string;
  bedrock?: boolean;
  onOutput?: (chunk: string) => void;
  promptViaStdin?: boolean;
  onDebugEvent?: AgentDebugEvent;
}

const WATCHDOG_GRACE_MS = 10 * 1000;

function killProcessTree(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const { agent, prompt, timeoutMs, model, onOutput, promptViaStdin, onDebugEvent } = options;
  const bedrock = options.bedrock ?? process.env.EDS_BEDROCK === '1';

  const binary = resolveBinary(agent);
  const useStdin = !!promptViaStdin;
  const args = buildArgs(agent, prompt, model, useStdin, bedrock);

  const startedAt = Date.now();
  onDebugEvent?.('run.start', {
    agent,
    binary,
    model,
    bedrock: !!bedrock,
    timeoutMs,
    promptLen: prompt.length,
    promptHead: prompt.slice(0, 500),
  });

  return new Promise((resolve) => {
    const bedrockEnv = bedrock ? BEDROCK_ENV_BY_AGENT[agent] : undefined;
    const child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      ...(bedrockEnv ? { env: { ...process.env, ...bedrockEnv } } : {}),
    });

    if (useStdin && child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.write(prompt, () => {
        child.stdin?.end();
      });
    } else {
      child.stdin?.end();
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const pid = child.pid;

    const settle = (result: AgentRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      onDebugEvent?.('run.end', {
        agent,
        model,
        durationMs: Date.now() - startedAt,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdoutLen: result.stdout.length,
        stderrLen: result.stderr.length,
        stderrTail: result.stderr.slice(-1000),
      });
      resolve(result);
    };

    const softTimer = setTimeout(() => {
      timedOut = true;
      if (pid) killProcessTree(pid, 'SIGTERM');
    }, timeoutMs);

    const hardTimer = setTimeout(() => {
      if (settled) return;
      if (pid) killProcessTree(pid, 'SIGKILL');
      try {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.stdin?.destroy();
      } catch {}
      settle({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut: true,
      });
    }, timeoutMs + WATCHDOG_GRACE_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      if (onOutput) onOutput(chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (err) => {
      settle({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: `${err instanceof Error ? err.message : String(err)}\n${Buffer.concat(stderrChunks).toString('utf8')}`,
        timedOut,
      });
    });

    child.on('close', (code, signal) => {
      settle({
        exitCode: signal ? 1 : (code ?? 1),
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
      });
    });
  });
}
