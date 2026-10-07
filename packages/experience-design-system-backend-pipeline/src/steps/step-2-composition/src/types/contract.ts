import type { RawComponentDefinition } from '../../../step-1-extraction/src/types/extraction.js';
import type { AgentName } from '../../../shared/generation/index.js';
import type { CandidateFile } from '../../../shared/types.js';

export type { CandidateFile };
export type SelectedCandidate = CandidateFile & { matchReason: string };

export type ApplyCompositionEdgesResult = {
  components: RawComponentDefinition[];
  warnings: string[];
};

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

export interface ComposeComponentsRequest extends Omit<ResolveCompositionServiceOptions, 'agent' | 'forceAgent'> {
  agent?: string;
  forceAgent?: boolean;
}

export type ComposeComponentsResponse = ResolveCompositionServiceResult;
