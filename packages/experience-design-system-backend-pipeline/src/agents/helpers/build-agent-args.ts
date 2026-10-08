import type { AgentName } from '../types/agent-name.js';
import { buildClaudeArgs } from './build-args/build-claude-args.js';
import { buildCodexArgs } from './build-args/build-codex-args.js';
import { buildCopilotArgs } from './build-args/build-copilot-args.js';
import { buildCursorArgs } from './build-args/build-cursor-args.js';
import { buildOpencodeArgs } from './build-args/build-opencode-args.js';
import { resolveAgentModel } from './resolution/resolve-agent-model.js';

/**
 * Build the argv for a given agent CLI, including the model flag and any
 * Bedrock-provider overrides. When `promptViaStdin` is true the prompt is
 * omitted from argv (callers deliver it on stdin to avoid ARG_MAX overflow).
 */
export function buildArgs(
  agent: AgentName,
  prompt: string,
  model?: string,
  promptViaStdin = false,
  bedrock = false,
): string[] {
  const resolvedModel = resolveAgentModel(agent, model, bedrock);
  const modelArg = resolvedModel ? ['--model', resolvedModel] : [];
  const promptArg = promptViaStdin ? [] : [prompt];

  switch (agent) {
    case 'claude':
      return buildClaudeArgs(modelArg, promptArg);
    case 'codex':
      return buildCodexArgs(modelArg, promptArg, bedrock);
    case 'opencode':
      return buildOpencodeArgs(modelArg, promptArg);
    case 'cursor':
      return buildCursorArgs(modelArg, promptArg);
    case 'copilot':
      return buildCopilotArgs(model, promptArg);
  }
}
