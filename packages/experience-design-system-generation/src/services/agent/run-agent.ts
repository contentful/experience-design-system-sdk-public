import { spawn } from 'node:child_process';
import type { AgentName } from '../../agent-names.js';
import type { AgentRunResult, AgentDebugEvent } from '../../types/agent.js';
import { resolveAgentBinary } from './helpers/resolve-agent-binary.js';
import { buildAgentArgs, BEDROCK_ENV_BY_AGENT } from './helpers/build-agent-args.js';

export function describeAgentFailure(result: AgentRunResult, maxDetail = 800): string {
  const base = result.exitCode !== 0 ? `agent exited with code ${result.exitCode}` : 'agent produced no tool calls';
  const detail = (result.stderr.trim() || result.stdout.trim()).slice(-maxDetail).trim();
  return detail ? `${base} — ${detail}` : base;
}

export function extractSentinelOutput(stdout: string): string | null | 'multiple' {
  const START = '<<<EDS_OUTPUT_START>>>';
  const END = '<<<EDS_OUTPUT_END>>>';
  const startIdx = stdout.indexOf(START);
  const endIdx = stdout.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  const secondStart = stdout.indexOf(START, startIdx + START.length);
  if (secondStart !== -1 && secondStart < endIdx) return 'multiple';
  const afterStart = stdout.indexOf(END, startIdx);
  const secondEnd = stdout.indexOf(END, afterStart + END.length);
  if (secondEnd !== -1) return 'multiple';
  return stdout.slice(startIdx + START.length, endIdx).trim();
}

export async function runAgent(options: {
  agent: AgentName;
  prompt: string;
  timeoutMs: number;
  model?: string;
  bedrock?: boolean;
  onOutput?: (chunk: string) => void;
  promptViaStdin?: boolean;
  onDebugEvent?: AgentDebugEvent;
}): Promise<AgentRunResult> {
  const { agent, prompt, timeoutMs, model, onOutput, promptViaStdin, onDebugEvent } = options;
  const bedrock = options.bedrock ?? process.env.EDS_BEDROCK === '1';

  const binary = resolveAgentBinary(agent);
  const useStdin = !!promptViaStdin;
  const args = buildAgentArgs(agent, prompt, model, useStdin, bedrock);

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
      const result = {
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
