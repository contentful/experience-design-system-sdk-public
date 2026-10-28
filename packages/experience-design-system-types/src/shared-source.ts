export type SharedSourceCoverage = 'complete-within-declared-bound' | 'partial' | 'unavailable';

export interface SharedSourceCallerCoverage {
  scope: 'admitted-source';
  analysis: 'lexical-jsx-in-known-component-bodies' | 'configured-lexical-references';
  coverage: 'partial';
  files: Array<{ path: string; status: 'analyzed' | 'unsupported' | 'parse-error' }>;
  unresolvedReferences: number;
  unownedReferences: number;
  components: Array<{
    name: string;
    sourcePath: string;
    referenceCount: number;
    outcome: 'observed' | 'not-observed' | 'unknown';
    reason: string;
  }>;
}

export interface SharedSourceRange {
  startLine: number;
  endLine: number;
  displayStartLine: number;
}

export interface SharedSourceFile {
  path: string;
  content: string;
  partial: boolean;
  fileId?: string;
  compilerContextId?: string;
  canonicalPath?: string;
  textHash?: string | null;
  coverage?: SharedSourceCoverage;
  ranges?: SharedSourceRange[];
  roles?: string[];
  componentRefs?: Array<{
    componentId: string;
    name: string;
    roles: string[];
    observations?: Array<{ role: string; startLine: number; endLine: number }>;
  }>;
}

export interface SharedSourceCompilerContext {
  contextId: string;
  configPath: string | null;
  status: 'configured' | 'fallback' | 'ambiguous' | 'invalid';
  referenceOutcome: 'selected' | 'fallback' | 'missing' | 'ambiguous' | 'invalid' | 'cycle' | 'budget-exhausted';
  compilerOptions: Record<string, unknown>;
  configFiles: Array<{ fileId: string; textHash: string | null }>;
  diagnostics: string[];
}

export interface SharedSourceReference {
  path: string;
  role: string;
  partial: boolean;
  fileId?: string;
}

/** Source files are stored once; lexical references do not prove runtime execution. */
export interface SharedSource {
  inventory?: unknown;
  omittedInventory?: number;
  files: SharedSourceFile[];
  /** Absent on older snapshots; missing configuration is unknown. */
  compilerContexts?: SharedSourceCompilerContext[];
  omittedCompilerContexts?: number;
  components: Array<{
    component: string;
    source: string;
    refs: SharedSourceReference[];
    componentId?: string;
  }>;
  captureId?: string;
  captureDigest?: string;
  envelopeId?: string;
  envelopeDigest?: string;
  sessionId?: string;
  extractionStepId?: number;
  coverage?: SharedSourceCoverage;
  promptCoverage?: SharedSourceCoverage;
  /** Legacy snapshot metadata; ignored and removed from new prompt projections. */
  projectionBounds?: { maxBytes: number; usedBytes: number };
  extractionByteBinding?: 'verified-same' | 'changed' | 'unverified';
  omittedFiles?: number;
  omittedRanges?: number;
  omittedComponents?: number;
  omittedDiagnostics?: number;
  omittedObservations?: number;
  diagnostics?: unknown[];
  observations?: {
    accepted: unknown[];
    rejected: unknown[];
    callerCoverage?: SharedSourceCallerCoverage;
    referenceIndexes?: unknown[];
  };
}
