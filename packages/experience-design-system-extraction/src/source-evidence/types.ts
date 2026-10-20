export type SourceCoverage = 'complete-within-declared-bound' | 'partial' | 'unavailable';
export type ExtractionByteBinding = 'verified-same' | 'changed' | 'unverified';

export type SourceResolutionOutcome =
  | 'resolved'
  | 'unresolved'
  | 'external'
  | 'excluded'
  | 'unreadable'
  | 'cycle'
  | 'unsupported'
  | 'budget-exhausted';

export interface SourceCaptureLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxImportDepth: number;
  maxReadAttempts: number;
  maxResolverProbes: number;
  maxCaptureMs: number;
  maxPromptBytes: number;
  maxReferenceNodes?: number;
}

export const DEFAULT_SOURCE_CAPTURE_LIMITS: Readonly<SourceCaptureLimits> = {
  maxFiles: 256,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxImportDepth: 4,
  maxReadAttempts: 1024,
  maxResolverProbes: 4096,
  maxCaptureMs: 10_000,
  maxPromptBytes: 256 * 1024,
  maxReferenceNodes: 100_000,
};

export interface SourceComponentReference {
  componentId: string;
  name: string;
  roles: string[];
  observations?: Array<{ role: string; startLine: number; endLine: number }>;
}

export interface CapturedSourceFile {
  fileId: string;
  canonicalPath: string;
  displayPath: string;
  textHash: string | null;
  captured:
    | { kind: 'full'; text: string }
    | { kind: 'excerpts'; ranges: Array<{ startLine: number; endLine: number; text: string }> }
    | { kind: 'unavailable'; reason: string };
  roles: string[];
  componentRefs: SourceComponentReference[];
}

export interface SourceResolution {
  fromFileId: string;
  specifier: string;
  outcome: SourceResolutionOutcome;
  targetFileId?: string;
  reason?: string;
}

export interface SourceCaptureDiagnostic {
  kind: 'read' | 'config' | 'parse' | 'budget' | 'excluded';
  fileId?: string;
  reason: string;
}

export interface SourceCapture {
  schemaVersion: 1;
  captureId: string;
  digest: string;
  projectRoot: string;
  files: CapturedSourceFile[];
  resolution: SourceResolution[];
  diagnostics: SourceCaptureDiagnostic[];
  bounds: { limits: SourceCaptureLimits; used: Record<string, number> };
  coverage: SourceCoverage;
  extractionByteBinding: ExtractionByteBinding;
}

export interface CaptureSourceEvidenceRequest {
  projectRoot: string;
  filePaths: readonly string[];
  components?: ReadonlyArray<{ componentId: string; name: string; sourcePath?: string }>;
  limits?: Partial<SourceCaptureLimits>;
  signal?: AbortSignal;
}
