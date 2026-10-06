import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import type { AgentName } from '@contentful/experience-design-system-generation';

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

export interface SelectComponentsEndpointRequest {
  components: RawComponentDefinition[];
  agent?: string;
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

export type SelectComponentsEndpointResponse = SelectionServiceResult;
