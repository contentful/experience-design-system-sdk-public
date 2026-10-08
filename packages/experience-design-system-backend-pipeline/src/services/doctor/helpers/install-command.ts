import type { AgentDefinition } from '../types/agent-definition.js';

export function installCommand(agent: AgentDefinition): string {
  return `npm install -g ${agent.packageName}`;
}

export function installHint(agent: AgentDefinition): string {
  return `${installCommand(agent)}${agent.installSuffix ?? ''}`;
}
