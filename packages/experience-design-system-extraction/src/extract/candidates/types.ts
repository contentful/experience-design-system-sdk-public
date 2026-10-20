export type SourceEvidenceKind = 'declaration' | 'runtime-object' | 'implementation' | 'binding';
export type SourceFactOrigin = 'own' | 'imported' | 'inherited-dom' | 'inherited-library' | 'mixed' | 'unknown';
export type SourceFactCertainty = 'certain' | 'ambiguous' | 'unknown';
export type SourceDomainOpenness = 'closed' | 'open' | 'unknown';
export type SourceFactBinding = 'verified' | 'changed' | 'unverified' | 'unavailable';
export const SOURCE_FACT_SCHEMA_VERSION = 4;
export const SUPPORTED_SOURCE_FACT_SCHEMA_VERSIONS = [3, 4] as const;

export interface SourceFactLocation {
  fileId: string | null;
  canonicalPath: string | null;
  textHash: string | null;
  startLine: number | null;
  endLine: number | null;
  /** UTF-16 source offsets; absent on older or line-only observations. */
  startOffset?: number | null;
  endOffset?: number | null;
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
  state?: 'value' | 'unsupported';
  value?: SourceJsonValue;
  reason?: string | null;
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
  advisoryShape: NativeSourceShape | null;
  sourceGraph?: SourceTypeGraph;
  shapeNotes: string[];
  requiredFieldDropped: boolean | null;
}

export interface WebComponentSyntaxObservation {
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

export interface VueSyntaxObservation {
  reader: 'vue';
  channel: 'prop' | 'slot-contract' | 'slot-template' | 'slot-access';
  occurrence: number;
  resolution: 'resolved' | 'partial' | 'unresolved';
  resolutionReason: string | null;
  expression: string;
  spreadPath: string[];
  conditions: string[];
  loops: string[];
  fallback: string | null;
  default: WebComponentSyntaxObservation['default'];
  typeLocations: SourceFactLocation[];
}

export type SourceSyntaxObservation = WebComponentSyntaxObservation | VueSyntaxObservation;

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
  /** Exact bytes delivered by the configured compiler filesystem host. */
  reads?: CompilerReadReceipt[];
  projects: CompilerProjectDiagnostic[];
  modules: CompilerModuleDiagnostic[];
  references: CompilerReferenceDiagnostic[];
  coverage: CompilerCoverage;
  limits: Record<string, number>;
  used: Record<string, number>;
}

export type SourceJsonValue = null | boolean | number | string | SourceJsonValue[] | { [key: string]: SourceJsonValue };
export interface NativeSourceShape {
  $type: 'string' | 'number' | 'boolean' | 'array' | 'record';
  $required: boolean;
  $description?: string;
  $values?: SourceJsonValue[];
  $items?: NativeSourceShape;
  $fields?: Record<string, NativeSourceShape>;
}
export interface SourceTypeNode {
  id: string;
  keyPath: string[];
  kind: string;
  typeText: string;
  required: boolean;
  declarations: SourceFactLocation[];
  domain: {
    openness: SourceDomainOpenness;
    declaredValues: SourceJsonValue[];
    provenance: 'compiler' | 'unknown';
    unrepresentedValues?: Array<{ typeText: string; reason: string }>;
  };
  fields?: Array<{ key: string; nodeId: string; required: boolean }>;
  items?: string[];
  alternatives?: string[];
  indexSignatures?: Array<{ keyType: string; valueNodeId: string }>;
  coverage: CompilerCoverage;
  reason: string | null;
}
export interface SourceTypeGraph {
  schemaVersion: 1;
  /** SDK traversal counts; checker-internal type resolution is not preemptible. */
  used?: { propertyEnumerations: number; enumeratedProperties: number; wrappedProperties: number };
  limitations?: string[];
  rootId: string;
  nodes: SourceTypeNode[];
  coverage: CompilerCoverage;
  limits: { maxDepth: number; maxNodes: number; maxFields: number };
  omittedCount: number;
}
