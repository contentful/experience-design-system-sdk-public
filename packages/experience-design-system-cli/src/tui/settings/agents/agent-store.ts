import { AGENT_NAMES, isAgentName, type AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { readV1Store, writeV1Store } from '../utils/v1-store.js';

// The agent settings live in the same config.json as everything else:
//
//   agent        the default agent, read by the import (`--agent` wins over it)
//   agentModel   the model for the default agent, read by the import (`--agent name:model` wins over it)
//   agents       each agent's own saved settings (its model and the path to its command), so changing the default
//                does not lose another agent's settings
//
// `agent` and `agentModel` stay because the import and the legacy `experiences setup` already read and write them.
// `agentModel` is always the default agent's entry in `agents`, so the two cannot disagree.

export type AgentSettings = {
  /** Passed as --model. Empty: the agent's built-in default (see defaultModelLabel). */
  model: string;
  /** Path to the agent's command. Empty: the command name is looked up on the PATH. */
  binary: string;
};
export type AgentConfig = {
  /** The agent the CLI uses when `--agent` is not given. */
  defaultAgent: AgentName;
  agents: Record<AgentName, AgentSettings>;
};

const DEFAULT_AGENT: AgentName = 'claude';

// How each agent is shown.
export const AGENT_LABELS: Record<AgentName, string> = {
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

export function emptyAgents(): Record<AgentName, AgentSettings> {
  return Object.fromEntries(AGENT_NAMES.map((name) => [name, { model: '', binary: '' }])) as Record<
    AgentName,
    AgentSettings
  >;
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
      if (entry && typeof entry === 'object') {
        const fields = entry as Record<string, unknown>;
        agents[name] = { model: asString(fields['model']), binary: asString(fields['binary']) };
      }
    }
  }

  // A model saved before this section existed (by `experiences setup`) belongs to the agent that was the default.
  // It is shown there until the user saves, which writes it under `agents`.
  const legacyModel = asString(store['agentModel']);
  if (legacyModel && !agents[defaultAgent].model)
    agents[defaultAgent] = { ...agents[defaultAgent], model: legacyModel };

  return { defaultAgent, agents };
}

export async function writeAgentConfig(config: AgentConfig): Promise<void> {
  const existing = await readV1Store();
  const merged: Record<string, unknown> = { ...existing };

  // Only what was set is saved, so an agent with nothing to say has no entry.
  const agents: Record<string, Partial<AgentSettings>> = {};
  for (const name of AGENT_NAMES) {
    const model = config.agents[name].model.trim();
    const binary = config.agents[name].binary.trim();
    if (model || binary) agents[name] = { ...(model ? { model } : {}), ...(binary ? { binary } : {}) };
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
