import type { RawComponentDefinition } from '../../../step-1-extraction/src/extraction-types.js';
import type { AgentName } from '../../../shared/src/agent/index.js';

export interface ComponentSelection {
  name: string;
  component_id: string;
  decision: 'accepted' | 'rejected';
  reason: string | null;
}

export interface SelectionServiceResult {
  selections: ComponentSelection[];
  warnings: string[];
}

export interface RunSelectionServiceOptions {
  components: RawComponentDefinition[];
  agent: AgentName;
  model?: string;
  promptText?: string;
  promptPath?: string;
  onCacheLookup?: (
    componentHash: string,
    promptHash: string,
  ) => { decision: 'accepted' | 'rejected'; reason: string | null } | null;
  onCacheStore?: (
    componentHash: string,
    promptHash: string,
    decision: 'accepted' | 'rejected',
    reason: string | null,
  ) => void;
  onWarning?: (message: string) => void;
}

export interface SelectComponentsEndpointRequest extends Omit<RunSelectionServiceOptions, 'agent'> {
  agent?: string;
}

export type SelectComponentsEndpointResponse = SelectionServiceResult;
