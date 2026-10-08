import type { AgentName } from '../../../agents/types/agent-name.js';

export interface AgentDefinition {
  name: string;
  binary: AgentName;
  packageName: string;
  installSuffix?: string;
  installable: boolean;
}
