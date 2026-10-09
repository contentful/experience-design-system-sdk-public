import type { AgentName } from '../types/agent-name.js';

/**
 * Default models per agent — lightweight/fast picks to control cost when no
 * explicit model is configured. codex is deliberately absent: with no entry
 * here it gets no `--model` at all, so the installed Codex CLI picks whatever
 * its account supports.
 */
export const DEFAULT_MODELS: Partial<Record<AgentName, string>> = {
  claude: 'haiku',
  opencode: 'claude-haiku-4-5',
  cursor: 'gpt-mini',
  copilot: 'Auto',
};

export const DEFAULT_AGENT_NAME: AgentName = 'claude';
