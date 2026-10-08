export const AGENT_NAMES = ['claude', 'codex', 'opencode', 'cursor', 'copilot'] as const;

export type AgentName = (typeof AGENT_NAMES)[number];
