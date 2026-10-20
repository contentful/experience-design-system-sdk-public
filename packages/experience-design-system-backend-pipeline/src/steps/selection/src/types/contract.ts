import type { AgentDebugEvent } from '../../../../agents/types/agent-run.js';
import type { RawComponentDefinition } from '../../../extraction/src/types/component.js';
import type { AgentName } from '../../../../agents/index.js';
import type { ExistingContentfulEntities } from '../../../generation/src/types/existing-entities.js';

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
  /** Caller-supplied, bounded source evidence for this selection prompt; absent means unknown. */
  selectionEvidenceInline?: string;
  existingContentfulEntities?: ExistingContentfulEntities | null;
  existingComponentsInline?: string;
  existingTokensInline?: string;
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
  onDebugEvent?: AgentDebugEvent;
}

export interface SelectComponentsEndpointRequest extends Omit<RunSelectionServiceOptions, 'agent'> {
  agent?: string;
}

export type SelectComponentsEndpointResponse = SelectionServiceResult;
