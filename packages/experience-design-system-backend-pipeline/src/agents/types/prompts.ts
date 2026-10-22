import type { SharedSource } from '@contentful/experience-design-system-types';
import type { CDFComponentEntry } from '../../steps/shared/index.js';

/**
 * `components` — classify component props;
 * `tokens` — classify design tokens;
 * `select` — decide whether a component belongs in Contentful Experience Orchestration;
 * `map-tokens` — suggest `$token.allowed` restrictions for design-category token props
 */
export type DebateRole = 'for' | 'against';
export type Skill =
  | 'components'
  | 'tokens'
  | 'select'
  | 'map-tokens'
  | 'debate-select'
  | 'explore-components'
  | 'explore-inventory'
  | 'tier'
  | 'verify'
  | 'check';

export type Mode = 'autonomous';

/**
 * A component name paired with the source file it was extracted from, for
 * token-mapping evidence. `content` is the real file text — this pipeline is
 * agent-fs-free by design, so the caller inlines the text here. `null` when
 * the file couldn't be read. `siblingFiles` carries relatively-imported files
 * (e.g. a co-located `.styles.ts`). `truncatedSiblingCount` and `usesNotShown`
 * retain omission receipts from partial saved source captures. The filesystem
 * reader inlines every discovered file in full.
 */
export interface ComponentSourceRef {
  component: string;
  sourcePath: string;
  content: string | null;
  sourceEvidence?: CapturedSourceRefMetadata;
  compilerContexts?: SharedSource['compilerContexts'];
  siblingFiles?: Array<{ path: string; content: string; sourceEvidence?: CapturedSourceRefMetadata }>;
  truncatedSiblingCount?: number;
  usesNotShown?: string[];
}

export interface CapturedSourceRefMetadata {
  captureId: string;
  captureDigest: string;
  textHash: string | null;
  coverage: 'complete-within-declared-bound' | 'partial' | 'unavailable';
  extractionByteBinding: 'verified-same' | 'changed' | 'unverified';
  lineRanges: Array<{ startLine: number; endLine: number }>;
  compilerContextId?: string;
}

/** Plain-data shape of the CDF generated so far — component name → component entry. */
export type GeneratedCdf = Record<string, CDFComponentEntry>;

export interface PromptOptions {
  stageAssignmentInline?: string;
  stageInputInline?: string;
  skill: Skill;
  mode: Mode;
  /** For debate-select: which position to argue; defaults to `for`. */
  debateRole?: DebateRole;
  /** For debate-select: the serialized disagreement under review. */
  disagreementInline?: string;
  rawComponentsInline?: string;
  /** Scoped plain compiler/source-candidate evidence, separate from authoring props. */
  compilerEvidenceInline?: string;
  /** Current per-component exploration judgments, retained as advisory evidence. */
  explorationJudgmentsInline?: string;
  propBucketsInline?: string;
  rawTokensInline?: string;
  /** Original filename for raw tokens — used to set the correct code fence language. */
  rawTokensFilename?: string;
  tokensInline?: string;
  tokenMapInline?: string;
  outDir: string;
  /** For components skill only: the single component's name (used in error messages). */
  componentName?: string;
  /** For map-tokens skill: the CDF generated so far. Filtered internally to design-category token-typed props only. */
  generatedCdf?: GeneratedCdf;
  /** For map-tokens skill: the full DTCG token tree. Flattened internally to a path+`$type` index, with `$value` stripped. */
  tokenTree?: Record<string, unknown>;
  /** Component source file references — consumption evidence for the components skill, explicit-restriction evidence (comments, allowlists) for map-tokens. */
  componentSourceRefs?: ComponentSourceRef[];
  /** Deduplicated saved source snapshot, included in full. */
  sharedSource?: SharedSource;
  /** Custom prompt path override — bundled invariants do NOT apply under an override. */
  skillPathOverride?: string;
  /** Inline prompt instructions, taking precedence over the bundled skill or path override. */
  skillContentOverride?: string;
  /** JSON-serialized summary of existing space Components. */
  existingComponentsInline?: string;
  /** JSON-serialized summary of existing space DesignTokens. */
  existingTokensInline?: string;
  /** Saved-session source and observation evidence for current selection consumers. */
  selectionEvidenceInline?: string;
  /** JSON-serialized hard allowlist for generated slot allowed-components references. */
  componentAllowlistInline?: string;
  /** Optional path identifying the model already imported into the target space; context only. */
  existingModelPath?: string;
}
