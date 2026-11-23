import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import type { AgentConversation, AgentDebugEvent, AgentRunResult } from '../types/agent-run.js';
import type { AgentName } from '../types/agent-name.js';
import { decodeAgentConversationOutput, isAgentConversation } from '../helpers/agent-conversation-output.js';
import { createAgentRuntimeRecorder } from '../helpers/agent-runtime-measurements.js';
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
  preserveConversation?: boolean;
  conversation?: AgentConversation;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const { agent, prompt, timeoutMs, model, onOutput, promptViaStdin, onDebugEvent, signal } = options;
  const bedrock = options.bedrock ?? process.env.EDS_BEDROCK === '1';

  if (signal?.aborted) return createAgentCancellationResult();
  if (options.conversation && !isAgentConversation(options.conversation, agent))
    throw new Error('Conversation continuation requires an exact matching agent conversation identity');
  const conversational = options.preserveConversation || !!options.conversation;
  const conversation =
    options.conversation ?? (conversational && agent === 'copilot' ? { agent, id: randomUUID() } : undefined);
  const runtime = createAgentRuntimeRecorder(agent, model, !!conversational);

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
    const args = buildArgs(
      agent,
      deliveredPrompt,
      model,
      useStdin,
      bedrock,
      conversational ? { id: conversation?.id, newSession: agent === 'copilot' && !options.conversation } : undefined,
    );
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
        runtime.launch();
        const child = spawn(binary, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
          ...(bedrockEnv ? { env: { ...process.env, ...bedrockEnv } } : {}),
        });
        runtime.attach(child);
        return child;
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
          ...(conversational
            ? { conversationMode: options.conversation ? 'resume' : 'new', conversationId: conversation?.id }
            : {}),
        });
      },
      onEnd: ({ result, signal: childSignal, durationMs }) => {
        runtime.processEnded();
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
    const decoded: AgentRunResult = conversational
      ? decodeAgentConversationOutput(agent, result, conversation)
      : result;
    profileStatus = signal?.aborted ? 'cancelled' : decoded.exitCode === 0 && !decoded.timedOut ? 'success' : 'error';
    if (conversational)
      onDebugEvent?.('run.conversation', {
        agent,
        conversationId: decoded.conversation?.id,
        resumed: !!options.conversation,
        exitCode: decoded.exitCode,
      });
    const measured: AgentRunResult = { ...decoded, measurements: runtime.finish() };
    onDebugEvent?.('run.measurements', { ...measured.measurements, nativeUsage: measured.nativeUsage });
    return measured;
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
