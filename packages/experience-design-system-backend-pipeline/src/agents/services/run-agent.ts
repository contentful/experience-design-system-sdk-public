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
  /** Apply the selected agent's Bedrock-routing env vars when enabled. */
  bedrock?: boolean;
  onOutput?: (chunk: string) => void;
  /** Deliver the prompt on stdin instead of as an argv positional (large prompts overflow ARG_MAX). */
  promptViaStdin?: boolean;
  /** Optional debug-event sink; callers own how/where events get logged. */
  onDebugEvent?: AgentDebugEvent;
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

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onOutput?.(text);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const result: AgentRunResult = {
        exitCode: signal ? 1 : (code ?? 1),
        stdout,
        stderr,
        timedOut,
      };
      onDebugEvent?.('run.end', {
        agent,
        model,
        durationMs: Date.now() - startedAt,
        exitCode: result.exitCode,
        signal,
        timedOut,
        stdoutLen: stdout.length,
        stderrLen: stderr.length,
        stderrTail: stderr.slice(-1000),
      });
      resolve(result);
    });
  });
}
