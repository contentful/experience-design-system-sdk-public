import { spawn } from 'node:child_process';
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
import {
  startImportProfileSpan,
  type ImportProfileSpan,
  type ImportProfileStatus,
} from '../../profiling/import-profile.js';

export interface RunAgentOptions {
  agent: AgentName;
  prompt: string;
  timeoutMs: number;
  model?: string;
  bedrock?: boolean;
  onOutput?: (chunk: string) => void;
  promptViaStdin?: boolean;
  onDebugEvent?: AgentDebugEvent;
  signal?: AbortSignal;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const { agent, prompt, timeoutMs, model, onOutput, promptViaStdin, onDebugEvent, signal } = options;
  const bedrock = options.bedrock ?? process.env.EDS_BEDROCK === '1';

  if (signal?.aborted) return createAgentCancellationResult();

  const binary = resolveBinary(agent);
  const useStdin = shouldUseStdinForPrompt(agent, promptViaStdin);
  let artifact: AgentPromptArtifact | undefined;
  const invocationProfile = startImportProfileSpan('agent.invocation', { agent });
  const preparationProfile = startImportProfileSpan('agent.transportPreparation', { agent });
  let subprocessProfile: ImportProfileSpan | undefined;
  let profileStatus: ImportProfileStatus = 'error';
  const preparationStarted = Date.now();
  try {
    if (shouldUsePromptArtifact(agent, prompt)) artifact = await createAgentPromptArtifact(prompt, signal);
    const deliveredPrompt = artifact?.prompt ?? prompt;
    const args = buildArgs(agent, deliveredPrompt, model, useStdin, bedrock);
    if (signal?.aborted) {
      profileStatus = 'cancelled';
      return createAgentCancellationResult();
    }

    preparationProfile.end();
    subprocessProfile = startImportProfileSpan('agent.subprocess', { agent });

    const result = await runAgentProcess({
      signal,
      processGroup: true,
      timeoutMs: artifact && timeoutMs !== 0 ? Math.max(1, timeoutMs - (Date.now() - preparationStarted)) : timeoutMs,
      stdinText: useStdin ? deliveredPrompt : undefined,
      onOutput,
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
        });
      },
    });
    profileStatus = signal?.aborted ? 'cancelled' : result.exitCode === 0 && !result.timedOut ? 'success' : 'error';
    subprocessProfile.end(profileStatus);
    return result;
  } catch (error) {
    profileStatus = signal?.aborted ? 'cancelled' : 'error';
    if (signal?.aborted) return createAgentCancellationResult();
    throw error;
  } finally {
    preparationProfile.end(profileStatus);
    subprocessProfile?.end(profileStatus);
    try {
      await artifact?.dispose();
    } catch (error) {
      invocationProfile.end('error');
      throw error;
    } finally {
      invocationProfile.end(profileStatus);
    }
  }
}
