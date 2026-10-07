import type { RawComponentDefinition } from '../../../step-1-extraction/src/types/component.js';
import type { AgentName } from '../../../shared/agent/index.js';
import type { CDFComponentEntry, DTCGTokenEntry } from '../../../shared/types/index.js';

export interface CdfGenerationFailure {
  componentName: string;
  error: string;
}

export interface RunCdfGenerationServiceOptions {
  components: RawComponentDefinition[];
  tokens?: DTCGTokenEntry[];
  agent: AgentName;
  model?: string;
  concurrency?: number;
  skillPathOverride?: string;
  skillContentOverride?: string;
  onProgress?: (componentName: string, index: number, total: number) => void;
  onCacheLookup?: (inputHash: string, promptHash: string) => CDFComponentEntry | null;
  onCacheStore?: (inputHash: string, promptHash: string, entry: CDFComponentEntry) => void;
  onWarning?: (message: string) => void;
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
