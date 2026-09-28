import type { AgentName } from '@contentful/experience-design-system-generation';

export interface AgentDefinition {
  name: string;
  binary: AgentName;
  /** The npm package that installs this agent, so callers never spell it out again. */
  packageName: string;
  installSuffix?: string;
  /** Whether `experiences setup` offers to install it. Copilot is detect-only. */
  installable: boolean;
}

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

export function installCommand(agent: AgentDefinition): string {
  return `npm install -g ${agent.packageName}`;
}

export function installHint(agent: AgentDefinition): string {
  return `${installCommand(agent)}${agent.installSuffix ?? ''}`;
}

export const INSTALLABLE_AGENTS = AGENT_DEFS.filter((agent) => agent.installable);
