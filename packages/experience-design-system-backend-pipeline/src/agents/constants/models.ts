import type { AgentName } from '../types/agent-name.js';

export const DEFAULT_OPENCODE_MODEL = 'claude-haiku-4-5';

/**
 * Default models per agent — lightweight/fast picks to control cost when no
 * explicit model is configured. codex is deliberately absent: with no entry
 * here it gets no `--model` at all, so the installed Codex CLI picks whatever
 * its account supports.
 */
export const DEFAULT_MODELS: Partial<Record<AgentName, string>> = {
  claude: 'haiku',
  opencode: DEFAULT_OPENCODE_MODEL,
  cursor: 'gpt-mini',
  copilot: 'Auto',
};

export const DEFAULT_AGENT_NAME: AgentName = 'claude';
