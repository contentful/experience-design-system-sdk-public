import type { AgentName } from '@contentful/experience-design-system-generation';

export interface AgentDefinition {
  name: string;
  binary: AgentName;
  installHint: string;
}

export const AGENT_DEFS: readonly AgentDefinition[] = [
  { name: 'Claude Code', binary: 'claude', installHint: 'npm install -g @anthropic-ai/claude-code && claude login' },
  { name: 'OpenAI Codex', binary: 'codex', installHint: 'npm install -g @openai/codex  (requires OPENAI_API_KEY)' },
  { name: 'OpenCode', binary: 'opencode', installHint: 'npm install -g opencode-ai && opencode auth' },
  { name: 'GitHub Copilot', binary: 'copilot', installHint: 'npm install -g @github/copilot && copilot' },
];
