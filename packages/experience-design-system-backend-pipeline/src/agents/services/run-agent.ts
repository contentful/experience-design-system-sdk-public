import { spawn } from 'node:child_process';
import {
  createAgentCancellationResult,
  formatArgvPromptSizeLimitError,
  MAX_ARGV_PROMPT_BYTES,
  runAgentProcess,
  shouldUseStdinForPrompt,
} from '@contentful/experience-design-system-types';
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
  /** Defaults to stdin for Claude/Codex; explicit choices override that default. */
  promptViaStdin?: boolean;
  /** Optional debug-event sink; callers own how/where events get logged. */
  onDebugEvent?: AgentDebugEvent;
  signal?: AbortSignal;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const { agent, prompt, timeoutMs, model, onOutput, promptViaStdin, onDebugEvent, signal } = options;
  const bedrock = options.bedrock ?? process.env.EDS_BEDROCK === '1';

  if (signal?.aborted) return createAgentCancellationResult();

  const binary = resolveBinary(agent);
  const useStdin = shouldUseStdinForPrompt(agent, promptViaStdin);
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  if (!useStdin && promptBytes > MAX_ARGV_PROMPT_BYTES) {
    return {
      stdout: '',
      stderr: formatArgvPromptSizeLimitError(agent, promptBytes),
      exitCode: 1,
      timedOut: false,
    };
  }
  const args = buildArgs(agent, prompt, model, useStdin, bedrock);
  if (signal?.aborted) return createAgentCancellationResult();

  return runAgentProcess({
    signal,
    timeoutMs,
    stdinText: useStdin ? prompt : undefined,
    onOutput,
    spawn: () => {
      const bedrockEnv = bedrock ? BEDROCK_ENV_BY_AGENT[agent] : undefined;
      return spawn(binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(bedrockEnv ? { env: { ...process.env, ...bedrockEnv } } : {}),
      });
    },
    onStart: () => {
      onDebugEvent?.('run.start', {
        agent,
        binary,
        model,
        bedrock: !!bedrock,
        timeoutMs,
        promptLen: prompt.length,
        promptHead: prompt.slice(0, 500),
      });
    },
    onEnd: ({ result, signal: childSignal, durationMs }) => {
      onDebugEvent?.('run.end', {
        agent,
        model,
        durationMs,
        exitCode: result.exitCode,
        signal: childSignal,
        timedOut: result.timedOut,
        stdoutLen: result.stdout.length,
        stderrLen: result.stderr.length,
        stderrTail: result.stderr.slice(-1000),
      });
    },
  });
}
