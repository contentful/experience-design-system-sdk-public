import { DEFAULT_CODEX_BEDROCK_MODEL } from '../constants/bedrock.js';
import { DEFAULT_MODELS, DEFAULT_OPENCODE_MODEL } from '../constants/models.js';
import type { AgentName } from '../types/agent-name.js';
import { withBedrockProviderPrefix } from './with-bedrock-provider-prefix.js';

/**
 * Resolve the model for an agent. Explicit flag/creds value wins, then a
 * per-agent `EDS_AGENT_MODEL_<AGENT>` env override, otherwise the lightweight
 * default. `bedrock` only affects the fallback default, and only for agents
 * whose model id changes shape under Bedrock (codex, opencode).
 */
export function resolveAgentModel(agent: AgentName, explicit?: string, bedrock = false): string | undefined {
  if (explicit && explicit.trim()) return explicit.trim();
  const override = process.env[`EDS_AGENT_MODEL_${agent.toUpperCase()}`];
  if (override && override.trim()) return override.trim();
  if (bedrock && agent === 'codex') return DEFAULT_CODEX_BEDROCK_MODEL;
  if (bedrock && agent === 'opencode') return withBedrockProviderPrefix(DEFAULT_OPENCODE_MODEL);
  return DEFAULT_MODELS[agent];
}
