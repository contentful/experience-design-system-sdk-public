export type SourceEvidenceKind = 'declaration' | 'runtime-object' | 'implementation' | 'binding';
export type SourceFactOrigin = 'own' | 'imported' | 'inherited-dom' | 'inherited-library' | 'mixed' | 'unknown';
export type SourceFactCertainty = 'certain' | 'ambiguous' | 'unknown';
export type SourceDomainOpenness = 'closed' | 'open' | 'unknown';
export type SourceFactBinding = 'verified' | 'changed' | 'unverified' | 'unavailable';
export const SOURCE_FACT_SCHEMA_VERSION = 3;

export interface SourceFactLocation {
  fileId: string | null;
  canonicalPath: string | null;
  textHash: string | null;
  startLine: number | null;
  endLine: number | null;
  binding: SourceFactBinding;
}

export interface SourceDomainLiteral {
  kind: 'string' | 'number' | 'boolean' | 'null';
  value: string;
}

export interface SourceDomain {
  observedLiterals: SourceDomainLiteral[];
  openness: SourceDomainOpenness;
}

export interface SourceDefaultFact {
  expression: string;
  location: SourceFactLocation | null;
}

export interface CompilerPropFact {
  origin: SourceFactOrigin;
  resolvedKind: string;
  certainty: SourceFactCertainty;
  ambiguityReason: string | null;
  declarations: SourceFactLocation[];
  sourceTypeText: string;
  domain: SourceDomain;
  declaredRequired: boolean | null;
  sourceDefault: SourceDefaultFact | null;
  advisoryShape: null;
  shapeNotes: string[];
  requiredFieldDropped: boolean | null;
}

export interface SourceSyntaxObservation {
  reader: 'web-component';
  lineage: 'own' | 'base' | 'mixin';
  declaringClass: string | null;
  converter: { state: 'known' | 'absent' | 'unknown'; expression: string | null };
  attribute: { state: 'explicit' | 'implicit' | 'disabled' | 'absent' | 'unknown'; name: string | null };
  reflect: { state: 'explicit' | 'absent' | 'unknown'; value: boolean | null };
  exposure: string[];
  default: {
    expression: string | null;
    state: 'literal' | 'resolved' | 'absent' | 'unresolved';
    value: SourceDomainLiteral | null;
    reason: string | null;
    locations: SourceFactLocation[];
  };
  typeLocations: SourceFactLocation[];
  slotKind: 'jsdoc' | 'literal-template' | null;
}

export interface SourceCandidateObservation {
  name: string;
  keyPath: string[];
  evidenceKind: SourceEvidenceKind;
  type: string;
  declaredRequired: boolean | null;
  sourceDefault: string | null;
  origin: SourceFactOrigin;
  location: SourceFactLocation | null;
  fact?: CompilerPropFact;
  syntax?: SourceSyntaxObservation;
}

export interface SourceCandidate {
  name: string;
  /** Exact source key segments; names containing dots or slashes are not split. */
  keyPath: string[];
  evidenceKinds: SourceEvidenceKind[];
  type: string;
  declaredRequired: boolean | null;
  sourceDefault: string | null;
  facts: CompilerPropFact | null;
  observations: SourceCandidateObservation[];
  projection: {
    kind: 'prop' | 'slot' | 'excluded' | 'unknown';
    reason: string | null;
  };
}

/** Candidate evidence from a duplicate source kept apart from the selected winner. */
export interface SourceCandidateSource {
  componentName: string;
  sourcePath: string;
  factSchemaVersion: number | null;
  candidates: SourceCandidate[] | null;
}

export interface SourceCandidateCollection {
  candidates: SourceCandidate[];
  omittedCount: number;
}

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

export interface ExtractionDiagnostics {
  schemaVersion: 1;
  projects: CompilerProjectDiagnostic[];
  modules: CompilerModuleDiagnostic[];
  references: CompilerReferenceDiagnostic[];
  coverage: CompilerCoverage;
  limits: Record<string, number>;
  used: Record<string, number>;
}
