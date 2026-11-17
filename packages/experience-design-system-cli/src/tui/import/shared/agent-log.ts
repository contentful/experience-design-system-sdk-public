import type { AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { AGENT_LABELS } from '@tui/settings/configuration/agents/agent-store.js';

/** How the steps that run an agent name it in a debug log: its label and the model, or that the default model was used. */
export const agentLine = (agent: string, model: string | undefined): string =>
  `${AGENT_LABELS[agent as AgentName] ?? agent} (${model ? `model ${model}` : 'default model'})`;
