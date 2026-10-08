import type { AgentDefinition } from '../types/agent-definition.js';

export const AGENT_DEFS: readonly AgentDefinition[] = [
  {
    name: 'Claude Code',
    binary: 'claude',
    packageName: '@anthropic-ai/claude-code',
    installSuffix: ' && claude login',
    installable: true,
  },
  {
    name: 'OpenAI Codex',
    binary: 'codex',
    packageName: '@openai/codex',
    installSuffix: '  (requires OPENAI_API_KEY)',
    installable: true,
  },
  {
    name: 'OpenCode',
    binary: 'opencode',
    packageName: 'opencode-ai',
    installSuffix: ' && opencode auth',
    installable: true,
  },
  {
    name: 'GitHub Copilot',
    binary: 'copilot',
    packageName: '@github/copilot',
    installSuffix: ' && copilot',
    installable: false,
  },
];

export const INSTALLABLE_AGENTS = AGENT_DEFS.filter((agent) => agent.installable);
