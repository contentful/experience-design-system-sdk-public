import type { AgentDebugEvent } from '../../../../agents/types/agent-run.js';
import type { RawComponentDefinition } from '../../../extraction/src/types/component.js';
import type { AgentName } from '../../../../agents/index.js';
import type { CDFComponentEntry, DTCGTokenEntry } from '../../../shared/index.js';
import type { SlotDecision } from '@contentful/experience-design-system-types';

export interface CdfGenerationFailure {
  componentName: string;
  error: string;
  propertyOutcomes?: import('../services/property/materialize-property.js').MaterializedProperty[];
}

export interface RunCdfGenerationServiceOptions {
  components: RawComponentDefinition[];
  acceptedSlots?: readonly SlotDecision[];
  signal?: AbortSignal;
  tokens?: DTCGTokenEntry[];
  /** Optional scoped compiler/source-candidate block for alternate fresh-generation callers. */
  compilerEvidenceInline?: string;
  explorationJudgmentsInline?: string;
  sharedSource?: import('@contentful/experience-design-system-types').SharedSource;
  componentSourceRefs?: import('../../../../agents/types/prompts.js').ComponentSourceRef[];
  onModelExploration?: (componentName: string, modelKey: string) => void;
  agent: AgentName;
  model?: string;
  concurrency?: number;
  skillPathOverride?: string;
  skillContentOverride?: string;
  onProgress?: (componentName: string, index: number, total: number) => void;
  onCacheLookup?: (inputHash: string, promptHash: string) => CDFComponentEntry | null;
  onCacheStore?: (inputHash: string, promptHash: string, entry: CDFComponentEntry) => void;
  onWarning?: (message: string) => void;
  onDebugEvent?: AgentDebugEvent;
}

export interface RunCdfGenerationServiceResult {
  components: CDFComponentEntry[];
  warnings: string[];
  failures: CdfGenerationFailure[];
}

export interface GenerateCdfComponentsRequest extends Omit<RunCdfGenerationServiceOptions, 'agent'> {
  agent?: string;
}

export type GenerateCdfComponentsResponse = RunCdfGenerationServiceResult;
