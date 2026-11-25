export type SourceFactBinding = 'verified' | 'changed' | 'unverified' | 'unavailable';

export type CompilerCoverage = 'complete-within-declared-bound' | 'partial' | 'unavailable';

export interface CompilerProjectDiagnostic {
  root: string;
  configPath: string | null;
  configHash: string | null;
  status: 'configured' | 'fallback' | 'invalid' | 'ambiguous';
  options: Record<string, string | number | boolean | null>;
  diagnostics: string[];
}

export interface CompilerModuleDiagnostic {
  specifier: string;
  fromPath: string;
  outcome: 'resolved' | 'unresolved' | 'external' | 'unavailable';
  reason: string | null;
}

export interface CompilerReferenceDiagnostic {
  root: string;
  configPath: string | null;
  outcome: 'selected' | 'fallback' | 'missing' | 'invalid' | 'ambiguous' | 'cycle' | 'budget-exhausted';
}

export interface CompilerReadReceipt {
  path: string;
  kind: 'config' | 'compiler' | 'framework' | 'virtual';
  textHash: string | null;
  byteLength: number;
  outcome: 'read' | 'unavailable';
  reason: string | null;
  binding?: SourceFactBinding;
}

export interface ExtractionDiagnostics {
  schemaVersion: 1;
  reads?: CompilerReadReceipt[];
  projects: CompilerProjectDiagnostic[];
  modules: CompilerModuleDiagnostic[];
  references: CompilerReferenceDiagnostic[];
  coverage: CompilerCoverage;
  limits: Record<string, number>;
  used: Record<string, number>;
}
