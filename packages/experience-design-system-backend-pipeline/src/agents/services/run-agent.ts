import { spawn, type ChildProcess } from 'node:child_process';
import {
  createAgentCancellationResult,
  createAgentPromptArtifact,
  shouldUsePromptArtifact,
  type AgentPromptArtifact,
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

const WATCHDOG_GRACE_MS = 10 * 1000;

/** Agent CLIs spawn their own tools; signal the whole detached group so none outlive the run. */
function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      process.kill(child.pid, signal);
    } catch {}
  }
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const { agent, prompt, timeoutMs, model, onOutput, promptViaStdin, onDebugEvent, signal } = options;
  const bedrock = options.bedrock ?? process.env.EDS_BEDROCK === '1';

  if (signal?.aborted) return createAgentCancellationResult();

  const binary = resolveBinary(agent);
  const useStdin = shouldUseStdinForPrompt(agent, promptViaStdin);
  let artifact: AgentPromptArtifact | undefined;
  const preparationStarted = Date.now();
  try {
    if (shouldUsePromptArtifact(agent, prompt)) artifact = await createAgentPromptArtifact(prompt, signal);
    const deliveredPrompt = artifact?.prompt ?? prompt;
    const args = buildArgs(agent, deliveredPrompt, model, useStdin, bedrock);
    if (signal?.aborted) return createAgentCancellationResult();

    return await runAgentProcess({
      signal,
      timeoutMs: artifact ? Math.max(1, timeoutMs - (Date.now() - preparationStarted)) : timeoutMs,
      stdinText: useStdin ? deliveredPrompt : undefined,
      onOutput,
      kill: killProcessTree,
      forceKillAfterMs: WATCHDOG_GRACE_MS,
      spawn: () => {
        const bedrockEnv = bedrock ? BEDROCK_ENV_BY_AGENT[agent] : undefined;
        return spawn(binary, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
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
          deliveredPromptLen: deliveredPrompt.length,
          promptTransport: artifact ? 'file' : useStdin ? 'stdin' : 'argv',
          ...(artifact ? { promptArtifact: artifact.path } : {}),
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
  } catch (error) {
    if (signal?.aborted) return createAgentCancellationResult();
    throw error;
  } finally {
    await artifact?.dispose();
  }
}
