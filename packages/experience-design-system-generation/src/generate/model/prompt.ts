import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

/** `components` — classify component props; `tokens` — classify design tokens; `select` — decide whether a component belongs in Contentful Experience Orchestration; `map-tokens` — suggest `$token.allowed` restrictions for design-category token props */
export type Skill = 'components' | 'tokens' | 'select' | 'map-tokens';
export type Mode = 'autonomous';

/**
 * A component name paired with the source file it was extracted from, for
 * token-mapping evidence. `content` is the real file text (bounded, see
 * MAX_COMPONENT_SOURCE_CHARS) — this pipeline is agent-fs-free by design (see
 * generate-components.md's "you do not write any files"), so the caller must
 * read the file itself and inline the text here rather than handing the
 * agent a path and expecting it to open it. `null` when the file
 * could not be read (moved/deleted since extraction) — callers fall back to
 * inferring from the prop name and $token.kind alone in that case.
 * `siblingFiles` carries the content of files the source file relatively
 * imports (e.g. a co-located `.styles.ts`) — token-resolution logic often
 * lives one hop away from the component file itself. `truncatedSiblingCount`
 * is set when the caller found more resolvable sibling files than it inlines
 * (see MAX_SIBLING_FILES) — surfaced in the prompt so the classifier knows
 * evidence was dropped rather than that the search came up empty.
 */
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
  rawTokensInline?: string;
  /** Original filename for raw tokens — used to set the correct code fence language. */
  rawTokensFilename?: string;
  tokensInline?: string;
  tokenMapInline?: string;
  /** Retained for source compatibility; prompt services do not read or write this path. */
  outDir: string;
  /** For components skill only: the single component's name (used in error messages). */
  componentName?: string;
  /** Generated CDF so far — used by map-tokens to show the agent what is already classified. */
  generatedCdf?: GeneratedCdf;
  /** DTCG token tree — used by map-tokens to give the agent a candidate path index. */
  tokenTree?: Record<string, unknown>;
  /** Component source file references — consumption evidence for the components skill, explicit-restriction evidence (comments, allowlists) for map-tokens. */
  componentSourceRefs?: ComponentSourceRef[];
  /** Feature 8: custom prompt path override. */
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
