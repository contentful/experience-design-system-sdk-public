import type { CDFComponentEntry } from '../../steps/shared/index.js';

/**
 * `components` — classify component props;
 * `tokens` — classify design tokens;
 * `select` — decide whether a component belongs in Contentful Experience Orchestration;
 * `map-tokens` — suggest `$token.allowed` restrictions for design-category token props
 */
export type Skill = 'components' | 'tokens' | 'select' | 'map-tokens';

export type Mode = 'autonomous';

/**
 * A component name paired with the source file it was extracted from, for
 * token-mapping evidence. `content` is the real file text — this pipeline is
 * agent-fs-free by design, so the caller inlines the text here. `null` when
 * the file couldn't be read. `siblingFiles` carries relatively-imported files
 * (e.g. a co-located `.styles.ts`). `truncatedSiblingCount` is set when more
 * resolvable siblings were found than inlined. `usesNotShown` names properties
 * whose uses fell outside the excerpt budget.
 */
export interface ComponentSourceRef {
  component: string;
  sourcePath: string;
  content: string | null;
  siblingFiles?: Array<{ path: string; content: string }>;
  truncatedSiblingCount?: number;
  usesNotShown?: string[];
}

/** Plain-data shape of the CDF generated so far — component name → component entry. */
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
  outDir: string;
  /** For components skill only: the single component's name (used in error messages). */
  componentName?: string;
  /** For map-tokens skill: the CDF generated so far. Filtered internally to design-category token-typed props only. */
  generatedCdf?: GeneratedCdf;
  /** For map-tokens skill: the full DTCG token tree. Flattened internally to a path+`$type` index, with `$value` stripped. */
  tokenTree?: Record<string, unknown>;
  /** Component source file references — consumption evidence for the components skill, explicit-restriction evidence (comments, allowlists) for map-tokens. */
  componentSourceRefs?: ComponentSourceRef[];
  /** Custom prompt path override — bundled invariants do NOT apply under an override. */
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
