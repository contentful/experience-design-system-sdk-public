import type { RawComponentDefinition } from '../../../extraction/src/types/component.js';
import type { CandidateFile } from '../../../shared/index.js';
import type { ResolveMappingResult } from '../helpers/edges/resolve-mapping.js';

export type { CandidateFile };
export type SelectedCandidate = CandidateFile & { matchReason: string };

export type ApplyCompositionEdgesResult = {
  components: RawComponentDefinition[];
  warnings: string[];
};

export interface ResolveCompositionServiceOptions {
  components: RawComponentDefinition[];
  allFiles: Array<{ path: string; content: string }>;
  /** @deprecated Composition is deterministic; this option is ignored. */
  forceAgent?: boolean;
  /** @deprecated Composition does not invoke an agent; this option is ignored. */
  agent?: string;
  /** @deprecated Composition does not build a prompt; this option is ignored. */
  promptOverride?: string;
  onProgress?: (phase: string) => void;
  /** @deprecated Composition does not read agent results; this callback is ignored. */
  onCacheLookup?: (cacheKey: string) => string | null;
  /** @deprecated Composition does not produce agent results; this callback is ignored. */
  onCacheStore?: (cacheKey: string, stdout: string) => void;
  onWarning?: (message: string) => void;
}

export interface ResolveCompositionServiceResult extends Pick<
  ResolveMappingResult,
  'sourceCallSiteEvidence' | 'sourceCallSiteRejections' | 'sourceCallSiteCoverage'
> {
  components: RawComponentDefinition[];
  warnings: string[];
}

export type ComposeComponentsRequest = ResolveCompositionServiceOptions;

export type ComposeComponentsResponse = ResolveCompositionServiceResult;
