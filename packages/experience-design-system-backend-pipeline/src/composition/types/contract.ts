import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import type { AgentName } from '@contentful/experience-design-system-generation';

export interface ResolveCompositionServiceOptions {
  components: RawComponentDefinition[];
  allFiles: Array<{ path: string; content: string }>;
  forceAgent: boolean;
  agent: AgentName;
  promptOverride?: string;
  onProgress?: (phase: string) => void;
  onCacheLookup?: (cacheKey: string) => string | null;
  onCacheStore?: (cacheKey: string, stdout: string) => void;
  onWarning?: (message: string) => void;
}

export interface ResolveCompositionServiceResult {
  components: RawComponentDefinition[];
  warnings: string[];
}

export interface CompositionOrchestratorRequest {
  components: RawComponentDefinition[];
  allFiles: Array<{ path: string; content: string }>;
  forceAgent: boolean;
  agent: AgentName;
  promptOverride?: string;
  onProgress?: (phase: string) => void;
  onCacheLookup?: (cacheKey: string) => string | null;
  onCacheStore?: (cacheKey: string, stdout: string) => void;
  onWarning?: (message: string) => void;
}

export interface CompositionOrchestratorResult {
  components: RawComponentDefinition[];
  warnings: string[];
}

export interface ResolveCompositionEndpointRequest {
  components: RawComponentDefinition[];
  allFiles: Array<{ path: string; content: string }>;
  agent?: string;
  forceAgent?: boolean;
  promptOverride?: string;
  onProgress?: (phase: string) => void;
  onCacheLookup?: (cacheKey: string) => string | null;
  onCacheStore?: (cacheKey: string, stdout: string) => void;
  onWarning?: (message: string) => void;
}

export type ResolveCompositionEndpointResponse = CompositionOrchestratorResult;
