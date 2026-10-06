import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import type { AgentName } from '@contentful/experience-design-system-generation';
import type { CDFComponentEntry, DTCGTokenEntry } from '@contentful/experience-design-system-types';

export interface GeneratedComponent {
  name: string;
  entry: CDFComponentEntry;
}

export interface GenerationFailure {
  componentName: string;
  error: string;
}

export interface RunGenerationServiceOptions {
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

export interface RunGenerationServiceResult {
  components: CDFComponentEntry[];
  warnings: string[];
  failures: GenerationFailure[];
}

export interface GenerateComponentsRequest {
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

export type GenerateComponentsResponse = RunGenerationServiceResult;
