import type { AgentName } from '../../../agent-names.js';

/** Per-agent env vars that switch model calls to AWS Bedrock. */
export const BEDROCK_ENV_BY_AGENT: Partial<Record<AgentName, Record<string, string>>> = {
  claude: { CLAUDE_CODE_USE_BEDROCK: '1' },
};

const BEDROCK_CAPABLE_AGENTS = new Set<AgentName>(['claude', 'codex', 'opencode']);

export function agentSupportsBedrock(agent: AgentName): boolean {
  return BEDROCK_CAPABLE_AGENTS.has(agent);
}

const DEFAULT_CODEX_BEDROCK_REGION = 'us-east-1';
const DEFAULT_OPENCODE_MODEL = 'claude-haiku-4-5';
const DEFAULT_CODEX_BEDROCK_MODEL = 'openai.gpt-5.6-luna';

const DEFAULT_MODELS: Partial<Record<AgentName, string>> = {
  claude: 'haiku',
  opencode: DEFAULT_OPENCODE_MODEL,
  cursor: 'gpt-mini',
  copilot: 'Auto',
};

function withBedrockProviderPrefix(model: string): string {
  return model.includes('/') ? model : `amazon-bedrock/${model}`;
}

export function resolveAgentModel(agent: AgentName, explicit?: string, bedrock = false): string | undefined {
  if (explicit && explicit.trim()) return explicit.trim();
  const override = process.env[`EDS_AGENT_MODEL_${agent.toUpperCase()}`];
  if (override && override.trim()) return override.trim();
  if (bedrock && agent === 'codex') return DEFAULT_CODEX_BEDROCK_MODEL;
  if (bedrock && agent === 'opencode') return withBedrockProviderPrefix(DEFAULT_OPENCODE_MODEL);
  return DEFAULT_MODELS[agent];
}

function codexBedrockConfigArgs(): string[] {
  const region =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || DEFAULT_CODEX_BEDROCK_REGION;
  return ['-c', 'model_provider=amazon-bedrock', '-c', `model_providers.amazon-bedrock.region=${region}`];
}

export function buildAgentArgs(
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
