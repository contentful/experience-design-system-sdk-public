import { spawn } from 'node:child_process';
import {
  createAgentCancellationResult,
  formatArgvPromptSizeLimitError,
  MAX_ARGV_PROMPT_BYTES,
  runAgentProcess,
  shouldUseStdinForPrompt,
} from '@contentful/experience-design-system-types';
import type { AgentName } from '../../agent-names.js';
import type { AgentRunResult, AgentDebugEvent } from '../../types/agent.js';
import { resolveAgentBinary } from './helpers/resolve-agent-binary.js';
import { buildAgentArgs, BEDROCK_ENV_BY_AGENT } from './helpers/build-agent-args.js';
import { describeAgentFailure } from './helpers/describe-agent-failure.js';
import { extractSentinelOutput } from './helpers/extract-sentinel-output.js';

export { describeAgentFailure, extractSentinelOutput };

export async function runAgent(options: {
  agent: AgentName;
  prompt: string;
  timeoutMs: number;
  model?: string;
  bedrock?: boolean;
  onOutput?: (chunk: string) => void;
  promptViaStdin?: boolean;
  onDebugEvent?: AgentDebugEvent;
  signal?: AbortSignal;
}): Promise<AgentRunResult> {
  const { agent, prompt, timeoutMs, model, onOutput, promptViaStdin, onDebugEvent, signal } = options;
  const bedrock = options.bedrock ?? process.env.EDS_BEDROCK === '1';

  if (signal?.aborted) return createAgentCancellationResult();

  const binary = resolveAgentBinary(agent);
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
  const args = buildAgentArgs(agent, prompt, model, useStdin, bedrock);
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
