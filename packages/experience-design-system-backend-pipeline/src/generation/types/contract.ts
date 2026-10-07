import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import type { AgentName } from '@contentful/experience-design-system-generation';
import type { CDFComponentEntry, DTCGTokenEntry } from '@contentful/experience-design-system-types';

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

export interface GenerateCdfComponentsRequest {
  components: RawComponentDefinition[];
  tokens?: DTCGTokenEntry[];
  agent?: string;
  model?: string;
  concurrency?: number;
  skillPathOverride?: string;
  skillContentOverride?: string;
  onProgress?: (componentName: string, index: number, total: number) => void;
  onCacheLookup?: (inputHash: string, promptHash: string) => CDFComponentEntry | null;
  onCacheStore?: (inputHash: string, promptHash: string, entry: CDFComponentEntry) => void;
  onWarning?: (message: string) => void;
}

export type GenerateCdfComponentsResponse = RunCdfGenerationServiceResult;
