export const AGENT_NAMES = ['claude', 'codex', 'opencode', 'cursor', 'copilot'] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

export const DEFAULT_AGENT_NAME: AgentName = 'claude';

export function isAgentName(value: string): value is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(value);
}
