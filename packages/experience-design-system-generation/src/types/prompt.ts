import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

export type Skill = 'components' | 'tokens' | 'select' | 'debate-select' | 'map-tokens';
export type DebateRole = 'for' | 'against';
export type Mode = 'autonomous';

export interface ComponentSourceRef {
  component: string;
  sourcePath: string;
  content: string | null;
  siblingFiles?: Array<{ path: string; content: string }>;
  truncatedSiblingCount?: number;
  /**
   * Properties with at least one use that fell outside the excerpt budget of
   * the file it sits in. The reader cannot see that use, so its absence is a
   * gap in the evidence, not evidence of absence.
   */
  usesNotShown?: string[];
}

/** Plain-data shape of the CDF generated so far — component name -> component entry. */
export type GeneratedCdf = Record<string, CDFComponentEntry>;

export interface PromptOptions {
  skill: Skill;
  mode: Mode;
  rawComponentsInline?: string;
  /** For the debate-select skill: which side of the disagreement this agent argues. */
  debateRole?: DebateRole;
  /** For the debate-select skill: JSON-serialized disagreement under review. */
  disagreementInline?: string;
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
  /** Component source file references — consumption evidence for the components skill, explicit-restriction evidence for map-tokens. */
  componentSourceRefs?: ComponentSourceRef[];
  /**
   * When set, this absolute or relative `.md` path is read in place of the
   * bundled skill file. Bundled-prompt invariants do NOT apply.
   */
  skillPathOverride?: string;
  /** Inline prompt instructions, taking precedence over the bundled skill or path override. */
  skillContentOverride?: string;
  /** JSON-serialized summary of existing space Components. */
  existingComponentsInline?: string;
  /** JSON-serialized summary of existing space DesignTokens. */
  existingTokensInline?: string;
  /** JSON-serialized hard allowlist for generated slot allowed-components references. */
  componentAllowlistInline?: string;
}
