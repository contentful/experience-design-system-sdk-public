import type { AgentName } from '../types/agent-name.js';
import { codexBedrockConfigArgs } from './codex-bedrock-config-args.js';
import { resolveAgentModel } from './resolve-agent-model.js';

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
      return ['--print', ...modelArg, ...promptArg];
    case 'codex': {
      const bedrockArgs = bedrock ? codexBedrockConfigArgs() : [];
      return ['exec', ...bedrockArgs, ...modelArg, '--dangerously-bypass-approvals-and-sandbox', ...promptArg];
    }
    case 'opencode':
      return ['run', ...modelArg, ...promptArg];
    case 'cursor':
      return ['--print', ...modelArg, ...promptArg];
    case 'copilot': {
      const copilotModel = resolveAgentModel('copilot', model);
      const copilotModelArg = !copilotModel || copilotModel === 'Auto' ? [] : ['--model', copilotModel];
      return ['-p', ...promptArg, ...copilotModelArg, '--allow-all-tools'];
    }
  }
}
