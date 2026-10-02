import type { AgentName } from '../model/agent.js';

const AGENT_BINARIES: Record<AgentName, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  cursor: 'cursor-agent',
  copilot: 'copilot',
};

export function resolveBinary(agent: AgentName): string {
  const envKey = `EDS_AGENT_BINARY_${agent.toUpperCase()}`;
  const override = process.env[envKey];
  if (override && override.trim()) return override.trim();
  return AGENT_BINARIES[agent];
}

/** Per-agent env vars that switch model calls to AWS Bedrock. */
const BEDROCK_ENV_BY_AGENT: Partial<Record<AgentName, Record<string, string>>> = {
  claude: { CLAUDE_CODE_USE_BEDROCK: '1' },
};

export function resolveAgentEnvironment(agent: AgentName, bedrock: boolean): Record<string, string> | undefined {
  return bedrock ? BEDROCK_ENV_BY_AGENT[agent] : undefined;
}

/**
 * Agents with a working Bedrock routing mechanism, of any shape (env var,
 * argv config override, or a provider-prefixed model string) — not just the
 * env-var agents in BEDROCK_ENV_BY_AGENT. cursor is excluded: its own Bedrock
 * support is currently broken for non-interactive/CI use.
 */
const BEDROCK_CAPABLE_AGENTS = new Set<AgentName>(['claude', 'codex', 'opencode']);

export function agentSupportsBedrock(agent: AgentName): boolean {
  return BEDROCK_CAPABLE_AGENTS.has(agent);
}

const DEFAULT_CODEX_BEDROCK_REGION = 'us-east-1';
const DEFAULT_OPENCODE_MODEL = 'claude-haiku-4-5';

/**
 * Default models per agent — lightweight/fast picks to control cost when no
 * explicit model is configured. cursor uses `gpt-mini` (verified alias from
 * GetUsableModels; haiku is not available in cursor's model catalog).
 *
 * codex is deliberately absent: with no entry here it gets no `--model` at
 * all, so the installed Codex CLI picks whatever its account supports. On
 * Bedrock it still needs an explicit id, since the model id there carries an
 * `openai.` prefix required by the Bedrock provider and absent from the
 * direct api.openai.com id — see DEFAULT_CODEX_BEDROCK_MODEL.
 */
const DEFAULT_MODELS: Partial<Record<AgentName, string>> = {
  claude: 'haiku',
  opencode: DEFAULT_OPENCODE_MODEL,
  cursor: 'gpt-mini',
  copilot: 'Auto',
};

const DEFAULT_CODEX_BEDROCK_MODEL = 'openai.gpt-5.6-luna';

/**
 * Resolve the model for an agent. Explicit flag/creds value wins, then a
 * per-agent `EDS_AGENT_MODEL_<AGENT>` env override, otherwise the lightweight
 * default for that agent. `bedrock` only affects the fallback default for
 * agents whose model id changes shape under Bedrock.
 */
export function resolveAgentModel(agent: AgentName, explicit?: string, bedrock = false): string | undefined {
  if (explicit && explicit.trim()) return explicit.trim();
  const override = process.env[`EDS_AGENT_MODEL_${agent.toUpperCase()}`];
  if (override && override.trim()) return override.trim();
  if (bedrock && agent === 'codex') return DEFAULT_CODEX_BEDROCK_MODEL;
  if (bedrock && agent === 'opencode') return withBedrockProviderPrefix(DEFAULT_OPENCODE_MODEL);
  return DEFAULT_MODELS[agent];
}

function withBedrockProviderPrefix(model: string): string {
  return model.includes('/') ? model : `amazon-bedrock/${model}`;
}

function codexBedrockConfigArgs(): string[] {
  const region =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || DEFAULT_CODEX_BEDROCK_REGION;
  return ['-c', 'model_provider=amazon-bedrock', '-c', `model_providers.amazon-bedrock.region=${region}`];
}

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
