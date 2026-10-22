import type { SourceFactCertainty, SourceFactLocation, CompilerCoverage } from '../candidates/types.js';

export interface ComponentObservationLimits {
  maxNodes: number;
  maxDepth: number;
  maxReferences: number;
  maxDeclarations: number;
  maxSignatures: number;
  maxObservations: number;
  maxManifestReads: number;
}
export interface SourceDeclarationOrigin {
  realPath: string | null;
  realpathStatus: 'resolved' | 'unavailable';
  selected: 'inside' | 'outside' | 'unknown';
  repository: 'inside' | 'outside' | 'unknown';
  packageStatus: 'resolved' | 'absent' | 'unavailable';
  package: { name: string; private: boolean | null; publication: 'unknown'; manifest: SourceFactLocation } | null;
}
export interface SourceSymbolEvidence {
  id: string | null;
  name: string;
  resolution: 'resolved' | 'ambiguous' | 'unresolved';
  defaultLibrary: boolean | null;
  aliases: Array<{ name: string; location: SourceFactLocation }>;
  declarations: Array<{ id: string; kind: string; location: SourceFactLocation; origin: SourceDeclarationOrigin }>;
}
export type SourceAccessSegment =
  | { kind: 'field'; name: string }
  | { kind: 'index'; value: string }
  | { kind: 'computed'; expression: string }
  | { kind: 'rest' };
export interface SourceInputAccessPath {
  rootSymbolId: string;
  rootDeclaration: SourceFactLocation;
  parameterIndex: number;
  segments: SourceAccessSegment[];
  certainty: SourceFactCertainty;
  reason: string | null;
}
export interface SourceCallableSignature {
  declaration: SourceFactLocation | null;
  parameters: Array<{ name: string; typeText: string; required: boolean | null; location: SourceFactLocation | null }>;
  returnTypeText: string;
}
export interface SourceObservationType {
  typeText: string;
  signatures: SourceCallableSignature[];
  resolvedSignature?: SourceCallableSignature | null;
  resultTypeText?: string;
}
export interface SourceObservationContext {
  lexicalDeclaration: SourceFactLocation | null;
  execution: 'component-body' | 'deferred' | 'referenced-body' | 'source-file';
  conditions: Array<{
    expression: string;
    branch: 'then' | 'else' | 'truthy' | 'falsy' | 'body' | 'case' | 'nullish';
    location: SourceFactLocation;
  }>;
}
export interface SourceObservationOperand {
  role: 'callee' | 'argument' | 'target' | 'value' | 'left' | 'right' | 'owner' | 'condition';
  index: number | null;
  expression: string;
  location: SourceFactLocation;
  symbol: SourceSymbolEvidence | null;
  inputPath: SourceInputAccessPath | null;
}
export interface ComponentSourceObservation {
  id: string;
  kind:
    | 'declaration'
    | 'binding'
    | 'call'
    | 'return'
    | 'assignment'
    | 'comparison'
    | 'condition'
    | 'member-read'
    | 'annotation'
    | 'throw'
    | 'assertion'
    | 'jsx-attribute'
    | 'jsx'
    | 'spread';
  expression: string;
  location: SourceFactLocation;
  certainty: SourceFactCertainty;
  context: SourceObservationContext;
  subject: SourceSymbolEvidence | null;
  inputPath?: SourceInputAccessPath | null;
  /** Reference an already-carried prop fact instead of reproducing its declaration/type graph. */
  candidateKeyPath?: string[];
  type?: SourceObservationType;
  operands?: SourceObservationOperand[];
  destination?: { kind: 'reference' | 'markup-attribute'; name: string };
  operator?: string;
  initializer?: string | null;
  resultUse?: {
    kind: 'discarded' | 'returned' | 'argument' | 'initializer' | 'member' | 'condition' | 'assigned' | 'expression';
    parentKind: string;
    location: SourceFactLocation;
  };
}
export interface ComponentSourceObservationCollection {
  schemaVersion: 1;
  fieldSemantics?: import('./field-semantics.js').SourceFieldSemantics;
  inputOutput?: import('./source-input-output.js').SourceInputOutputEvidence;
  referenceIndex?: import('./source-references.js').SourceReferenceIndex;
  componentDeclarationId: string;
  selectedSourcePaths: string[];
  repositoryRoot: string | null;
  observations: ComponentSourceObservation[];
  coverage: CompilerCoverage;
  /** These are SDK visitor bounds; compiler-internal resolution is not preemptible. */
  limits: ComponentObservationLimits;
  used: ComponentObservationLimits;
  omissions: Array<{ reason: string; location: SourceFactLocation | null; count: number }>;
}
