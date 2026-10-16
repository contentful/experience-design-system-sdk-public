import { AGENT_NAMES, isAgentName, type AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { readV1Store, writeV1Store } from '../utils/v1-store.js';

// The agent settings live in the same config.json as everything else:
//
//   agent        the default agent, read by the import (`--agent` wins over it)
//   agentModel   the model for the default agent, read by the import (`--agent name:model` wins over it)
//   agents       each agent's own saved settings, so changing the default does not lose another agent's model
//
// `agent` and `agentModel` stay because the import and the legacy `experiences setup` already read and write them.
// `agentModel` is always the default agent's entry in `agents`, so the two cannot disagree.

export type AgentSettings = { model: string };
export type AgentConfig = {
  /** The agent the CLI uses when `--agent` is not given. */
  defaultAgent: AgentName;
  agents: Record<AgentName, AgentSettings>;
};

const DEFAULT_AGENT: AgentName = 'claude';

// How each agent is shown. The binary is what the CLI looks for on the PATH (cursor's is `cursor-agent`).
export const AGENT_LABELS: Record<AgentName, string> = {
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
};

export const AGENT_HINTS: Record<AgentName, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  cursor: 'cursor-agent',
  copilot: 'copilot',
};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

export function emptyAgents(): Record<AgentName, AgentSettings> {
  return Object.fromEntries(AGENT_NAMES.map((name) => [name, { model: '' }])) as Record<AgentName, AgentSettings>;
}

export async function readAgentConfig(): Promise<AgentConfig> {
  const store = await readV1Store();
  const stored = asString(store['agent']);
  const defaultAgent: AgentName = isAgentName(stored) ? stored : DEFAULT_AGENT;

  const agents = emptyAgents();
  const saved = store['agents'];
  if (saved && typeof saved === 'object') {
    for (const name of AGENT_NAMES) {
      const entry = (saved as Record<string, unknown>)[name];
      if (entry && typeof entry === 'object')
        agents[name] = { model: asString((entry as Record<string, unknown>)['model']) };
    }
  }

  // A model saved before this section existed (by `experiences setup`) belongs to the agent that was the default.
  // It is shown there until the user saves, which writes it under `agents`.
  const legacyModel = asString(store['agentModel']);
  if (legacyModel && !agents[defaultAgent].model) agents[defaultAgent] = { model: legacyModel };

  return { defaultAgent, agents };
}

export async function writeAgentConfig(config: AgentConfig): Promise<void> {
  const existing = await readV1Store();
  const merged: Record<string, unknown> = { ...existing };

  const agents: Record<string, AgentSettings> = {};
  for (const name of AGENT_NAMES) {
    const model = config.agents[name].model.trim();
    if (model) agents[name] = { model };
  }

  // Not set when the user never picked one, so the import's own default (Claude) still applies.
  merged['agent'] = config.defaultAgent;
  const defaultModel = agents[config.defaultAgent]?.model;
  if (defaultModel) merged['agentModel'] = defaultModel;
  else delete merged['agentModel'];

  if (Object.keys(agents).length > 0) merged['agents'] = agents;
  else delete merged['agents'];

  await writeV1Store(merged);
}
