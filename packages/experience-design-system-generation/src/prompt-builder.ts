import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `components` — classify component props; `tokens` — classify design tokens; `select` — decide whether a component belongs in Contentful Experience Orchestration; `map-tokens` — suggest token sets/restrictions for design-category token props */
export type Skill = 'components' | 'tokens' | 'select' | 'map-tokens';
export type Mode = 'autonomous';

/**
 * A component name paired with the source file it was extracted from, for
 * token-mapping evidence. `content` is the real file text (bounded, see
 * MAX_COMPONENT_SOURCE_CHARS) — this pipeline is agent-fs-free by design (see
 * generate-components.md's "you do not write any files"), so the caller must
 * read the file itself and inline the text here rather than handing the
 * agent a path and expecting it to open the file. `null` when the file
 * couldn't be read (moved/deleted since extraction) — callers fall back to
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
}

interface CDFPropertyLike {
  $type?: unknown;
  $category?: unknown;
  [key: string]: unknown;
}

interface CDFComponentLike {
  $properties?: Record<string, CDFPropertyLike>;
  [key: string]: unknown;
}

/** Plain-data shape of the CDF generated so far — component name -> component entry. */
export type GeneratedCdf = Record<string, CDFComponentLike>;

interface TokenTreeNode {
  $type?: unknown;
  $value?: unknown;
  [key: string]: unknown;
}

/** Plain-data DTCG token tree (same shape passed to the `tokens` inline preamble section). */
export type TokenTree = Record<string, TokenTreeNode>;

interface TokenPathIndexEntry {
  path: string;
  type: string;
}

/**
 * Render the warning banner shown when a custom skill prompt is active.
 * Always cites the bundled invariants that the override bypasses so the
 * operator cannot miss it.
 */
export function formatCustomPromptBanner(skill: 'components' | 'select', path: string): string {
  return (
    `WARNING: Custom prompt active for ${skill}: ${path}\n` +
    `  Bundled invariants (utility-wrapper rejection, description content rules) do NOT apply.\n` +
    `  You are responsible for the prompt's correctness.\n`
  );
}

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
  tokenTree?: TokenTree;
  /** For map-tokens skill: component source file references, for restriction evidence (union types, defaults, comments). */
  componentSourceRefs?: ComponentSourceRef[];
  /**
   * Feature 8: custom prompt path override. When set, this absolute or relative
   * `.md` path is read in place of the bundled skill file. The bundled-prompt
   * invariants (utility-wrapper rejection, description content rules, etc.) do
   * NOT apply under an override — callers are responsible for showing the
   * appropriate warning banner.
   */
  skillPathOverride?: string;
}

const SKILL_FILES: Record<Skill, string> = {
  components: 'generate-components.md',
  tokens: 'generate-tokens.md',
  select: 'select-components.md',
  'map-tokens': 'map-tokens.md',
};

export async function buildPrompt(options: PromptOptions): Promise<string> {
  const skillContent = await readSkillFile(options.skill, options.skillPathOverride);
  const preamble = buildPreamble(options);
  return `${preamble}\n\nSkill instructions follow:\n---\n${skillContent}`;
}

export function resolveSkillPath(skill: Skill): string {
  if (!(skill in SKILL_FILES)) throw new Error(`Invalid skill: ${skill}`);
  // Walk up until we find the skills/ directory (works from both src/ and dist/src/ contexts)
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  for (;;) {
    const candidate = join(dir, 'skills');
    if (existsSync(candidate)) return join(candidate, SKILL_FILES[skill]);
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(`skill file missing from CLI installation (could not locate skills/ directory from: ${thisDir})`);
    }
    dir = parent;
  }
}

async function readSkillFile(skill: Skill, override?: string): Promise<string> {
  if (override) {
    const skillPath = resolve(override);
    try {
      return await readFile(skillPath, 'utf8');
    } catch {
      throw new Error(`custom prompt file not found (skill: ${skill}, path: ${skillPath})`);
    }
  }
  const skillPath = resolveSkillPath(skill);
  try {
    return await readFile(skillPath, 'utf8');
  } catch {
    throw new Error(`skill file missing from CLI installation — try reinstalling the CLI (looked for: ${skillPath})`);
  }
}

function inferFenceLang(filename: string | undefined): string {
  if (!filename) return 'json';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    js: 'js',
    mjs: 'js',
    cjs: 'js',
    ts: 'ts',
    mts: 'ts',
    cts: 'ts',
    tsx: 'tsx',
    jsx: 'jsx',
    vue: 'vue',
    svelte: 'svelte',
    astro: 'astro',
    scss: 'scss',
    sass: 'scss',
    css: 'css',
    json: 'json',
    json5: 'json',
  };
  return map[ext] ?? 'text';
}

/** Keeps only design-category, token-typed props per component; drops components left with none. */
function filterDesignTokenProps(cdf: GeneratedCdf): GeneratedCdf {
  const result: GeneratedCdf = {};
  for (const [componentName, component] of Object.entries(cdf)) {
    const properties = component.$properties;
    if (!properties) continue;
    const filteredProps: Record<string, CDFPropertyLike> = {};
    for (const [propName, prop] of Object.entries(properties)) {
      if (prop.$type === 'token' && prop.$category === 'design') {
        filteredProps[propName] = prop;
      }
    }
    if (Object.keys(filteredProps).length > 0) {
      result[componentName] = { ...component, $properties: filteredProps };
    }
  }
  return result;
}

/** Flattens a DTCG token tree to `{ path, type }` entries, stripping `$value`. */
function buildTokenPathIndex(tree: TokenTree, prefix = ''): TokenPathIndexEntry[] {
  const entries: TokenPathIndexEntry[] = [];
  for (const [key, node] of Object.entries(tree)) {
    if (key.startsWith('$') || node === null || typeof node !== 'object') continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof node.$type === 'string') {
      entries.push({ path, type: node.$type });
    } else {
      entries.push(...buildTokenPathIndex(node as TokenTree, path));
    }
  }
  return entries;
}

function buildPreamble(options: PromptOptions): string {
  const {
    skill,
    rawComponentsInline,
    rawTokensInline,
    rawTokensFilename,
    tokensInline,
    tokenMapInline,
    generatedCdf,
    tokenTree,
    componentSourceRefs,
  } = options;

  const sections: string[] = [];

  if (rawComponentsInline) {
    sections.push(`Raw component data (JSON):\n\`\`\`json\n${rawComponentsInline}\n\`\`\``);
  }
  if (rawTokensInline) {
    const lang = inferFenceLang(rawTokensFilename);
    const label = rawTokensFilename ? `Raw token source (${rawTokensFilename})` : 'Raw token source';
    sections.push(`${label}:\n\`\`\`${lang}\n${rawTokensInline}\n\`\`\``);
  }
  if (tokensInline) {
    sections.push(`DTCG token data (for token kind lookups):\n\`\`\`json\n${tokensInline}\n\`\`\``);
  }
  if (tokenMapInline) {
    sections.push(`Token-name sidecar (raw name → DTCG path):\n\`\`\`json\n${tokenMapInline}\n\`\`\``);
  }
  if (generatedCdf) {
    const filtered = filterDesignTokenProps(generatedCdf);
    if (Object.keys(filtered).length > 0) {
      sections.push(
        `Generated CDF so far — design-category token props only (JSON):\n\`\`\`json\n${JSON.stringify(filtered)}\n\`\`\``,
      );
    }
  }
  if (tokenTree) {
    const index = buildTokenPathIndex(tokenTree);
    if (index.length > 0) {
      sections.push(
        `Token path index — path and $type only, no $value (JSON):\n\`\`\`json\n${JSON.stringify(index)}\n\`\`\``,
      );
    }
  }
  if (componentSourceRefs && componentSourceRefs.length > 0) {
    const withContent = componentSourceRefs.filter((ref) => ref.content != null);
    const withoutContent = componentSourceRefs.filter((ref) => ref.content == null);
    if (withContent.length > 0) {
      const blocks = withContent.map((ref) => {
        const mainBlock = `#### ${ref.component} (\`${ref.sourcePath}\`)\n\`\`\`${inferFenceLang(ref.sourcePath)}\n${ref.content}\n\`\`\``;
        const siblingBlocks = (ref.siblingFiles ?? []).map(
          (sibling) =>
            `##### ${ref.component} — imported file \`${sibling.path}\`\n\`\`\`${inferFenceLang(sibling.path)}\n${sibling.content}\n\`\`\``,
        );
        const truncationNote =
          ref.truncatedSiblingCount && ref.truncatedSiblingCount > 0
            ? [
                `##### ${ref.component} — +${ref.truncatedSiblingCount} more imported file${ref.truncatedSiblingCount === 1 ? '' : 's'} not shown (evidence may be incomplete)`,
              ]
            : [];
        return [mainBlock, ...siblingBlocks, ...truncationNote].join('\n\n');
      });
      sections.push(`### Component source references\n\n${blocks.join('\n\n')}`);
    }
    if (withoutContent.length > 0) {
      sections.push(
        `Component source unavailable for (JSON) — infer from prop name and $token.kind alone for these:\n\`\`\`json\n${JSON.stringify(withoutContent.map((ref) => ({ component: ref.component, sourcePath: ref.sourcePath })))}\n\`\`\``,
      );
    }
  }

  const inputBlock = sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';

  if (skill === 'components') {
    return buildComponentsAutonomousPreamble(inputBlock);
  }
  if (skill === 'select') {
    return buildSelectAutonomousPreamble(inputBlock);
  }
  if (skill === 'map-tokens') {
    return buildMapTokensAutonomousPreamble(inputBlock);
  }
  return buildTokensAutonomousPreamble(inputBlock);
}

function buildComponentsAutonomousPreamble(inputBlock: string): string {
  return `You are running as part of the experience-design-system-cli generate pipeline in AUTONOMOUS mode. The developer is not present to answer questions.

Context: You are classifying a React component for **Contentful Experience Orchestration**. The result is a Component Type — a schema that tells Contentful what a marketer can configure. Properties fall into three categories:
- **design**: controls how the component looks (variant, size, color, layout toggles)
- **content**: the data a content editor fills in (text, images, URLs, rich text)
- **state**: runtime behavioral flags (disabled, loading, expanded, identifiers)

For props with complex TypeScript types (named types, enums): reason from the prop name and type name to classify them. Do not automatically exclude a prop just because its type is a named reference — infer the likely values and classify it as enum if it controls appearance.

Your task: classify every prop and slot in the component below. Apply all judgment calls yourself — do not pause to ask for confirmation. Include a "description" field on each tool call to document your reasoning so the developer can review it afterward.

All input data is provided inline below — do not read any additional files.${inputBlock}

## Output protocol

Do NOT write any files or emit any JSON blobs. Instead, emit one JSON object per line to stdout for each classification decision. The CLI reads your stdout line by line and writes each decision directly to the pipeline database.

The four tool calls you may emit are:

\`\`\`
{"tool":"classify_component","description":"<optional component-level description>","rationale":{"description":"<why this component is classified the way it is>","props":"<why these props were chosen>","slots":"<why these slots were chosen>"}}

{"tool":"classify_prop","prop":"<propName>","cdf_type":"<type>","cdf_category":"<category>","required":<bool>,"description":"<short customer-facing description>","reason":"<full internal rationale; not customer-facing>","values":["a","b"],"token_kind":"color","default":"<value>"}

{"tool":"exclude_prop","prop":"<propName>","reason":"<why excluded>"}

{"tool":"classify_slot","slot":"<slotName>","required":<bool>,"allowed_components":["ComponentName"],"description":"<reason>","rationale":"<why this slot was kept in the catalog>"}
\`\`\`

Rules:
- Emit exactly one JSON object per line. No multi-line JSON. No markdown fences around the lines.
- Every prop in the input must have exactly one call: either classify_prop or exclude_prop.
- Every slot in the input must have exactly one classify_slot call.
- Valid cdf_type values: string, richtext, media, enum, token, boolean
- Valid cdf_category values: content, design, state
- For enum type, always include "values" (non-empty string array).
- For token type, always include "token_kind" (DTCG \$type, e.g. "color").
- href and URL props → cdf_type "string", cdf_category "content". Do NOT use cdf_type "link" — it is not valid.
- Framework internals (ref, event handlers, test IDs) → exclude_prop.
- CSS design props (className, style, styles, positional/geometric props: top, bottom, left, right, rotation, offset, etc.) → classify_prop, cdf_type: "string", cdf_category: "design".
- On classify_component, "rationale" fields are operator-facing (read-only) but may surface in customer-facing exports. The "rationale.description" field is subject to the description content rules in the skill prompt (no internal initiative names). "rationale.props" and "rationale.slots" describe your reasoning about scope; "classify_slot.rationale" explains why each slot was kept.
- On classify_prop, "reason" is REQUIRED and is the LLM's internal rationale — shown to the developer reviewing the import, never to end-users. "description" is the customer-facing copy and is subject to the description content rules in the skill prompt. Keep them distinct: "description" is short and customer-facing; "reason" explains your reasoning in detail.
- You may emit prose lines (not starting with {) anywhere — they are ignored by the parser and serve as your reasoning log.`;
}

function buildSelectAutonomousPreamble(inputBlock: string): string {
  return `You are running as part of the experience-design-system-cli import pipeline in AUTONOMOUS mode. The developer is not present to answer questions.

Your task: review the components provided below and decide whether each belongs in Contentful Experience Orchestration as a Component Type. The input is a JSON array — you may receive 1–N components in a single message. Emit one tool call per input component, named after the component. Apply all judgment calls yourself — do not pause to ask for confirmation. Include a brief "reason" to document your reasoning for each decision.

Key rule: accept any component that renders visible UI — atoms, molecules, and organisms are all valid Component Types in Contentful Experience Orchestration. Reject only components that produce zero visual output: React hooks, pure context providers, A/B testing or variant-routing wrappers, analytics trackers, and security utilities. Do NOT reject a component because it has few props, is low-level, or has some A/B testing or personalization-related props mixed in — those props are handled in the generate step.

All input data is provided inline below — do not read any additional files.${inputBlock}

## Output protocol

Do NOT write any files or emit any JSON blobs. Instead, emit JSON tool calls one per line to stdout. The CLI reads your stdout line by line.

The two tool calls — emit exactly one per input component:

\`\`\`
{"tool":"select_component","name":"<ComponentName>","reason":"<brief reason>"}

{"tool":"reject_component","name":"<ComponentName>","reason":"<brief reason>"}
\`\`\`

Rules:
- Emit exactly one JSON object per line. No multi-line JSON. No markdown fences.
- Emit exactly one tool call per input component. The "name" field must match a component name from the input array exactly. Tool calls may appear in any order.
- You may emit prose lines (not starting with {) to reason before each tool call — they are ignored by the parser.`;
}

function buildMapTokensAutonomousPreamble(inputBlock: string): string {
  return `You are running as part of the experience-design-system-cli generate pipeline in AUTONOMOUS mode. The developer is not present to answer questions.

Context: The components below already have design-category, token-typed props (\`$token.kind\` set). Your task is to suggest, for each such prop, which token set from the design library it draws from (\`token_sets\`) and, when there is concrete evidence, which subset of that set a marketer may actually choose from (\`token_allowed\`). Apply all judgment calls yourself — do not pause to ask for confirmation.

All input data is provided inline below — do not read any additional files.${inputBlock}

## Output protocol

Do NOT write any files or emit any JSON blobs. Instead, emit one JSON object per line to stdout for each prop you map. The CLI reads your stdout line by line and writes each decision directly to the pipeline database.

The one tool call you may emit:

\`\`\`
{"tool":"map_token_prop","component":"<ComponentName>","prop":"<propName>","token_sets":["colors.brand.primary","colors.brand.secondary","colors.brand.tertiary"],"token_allowed":["colors.brand.primary","colors.brand.secondary"],"description":"<reason>"}
\`\`\`

Rules:
- Emit exactly one JSON object per line. No multi-line JSON. No markdown fences around the lines.
- Only emit a call for a prop that appears in the "Generated CDF so far" section — those are already confirmed design-category, token-typed props.
- \`token_sets\` and \`token_allowed\` are flat lists of individual **leaf** token paths — never a group/prefix path. The "Token path index" contains one entry per leaf token only; a path like \`colors.brand\` that groups \`colors.brand.primary\`/\`colors.brand.secondary\` does NOT itself appear in the index and must never be emitted. If a prop's relevant set is "the brand colors," enumerate every leaf under that group that appears in the index (e.g. \`colors.brand.primary\`, \`colors.brand.secondary\`, \`colors.brand.tertiary\`), not the group name.
- Every path in \`token_sets\` and \`token_allowed\` must exist verbatim in the "Token path index" section. Never invent a path. If a path you'd otherwise suggest is missing from the index, omit it rather than guessing.
- \`token_allowed\` must be a subset of \`token_sets\`.
- Restriction requires evidence: a union/enum-shaped prop type, a default value, or an explicit comment in the component source. Omit \`token_allowed\` entirely when you have no such evidence — do not include it as a placeholder.
- An empty \`token_allowed\` array is a deliberate, evidenced claim that nothing in \`token_sets\` is restricted (everything is allowed) — only emit it when you actually reviewed the evidence and found no restriction, not as a default.
- If the prop's source shows an existing \`tokenReference\` (a CSS custom property or design-token reference), treat it as high-confidence evidence and never contradict it in \`token_sets\` or \`token_allowed\`.
- No \`$value\` is provided in this step — do not reason about specific token values, only paths and \`$type\`.
- You may emit prose lines (not starting with \`{\`) anywhere — they are ignored by the parser and serve as your reasoning log.
- If a prop has no plausible token set in the provided index, skip it entirely — do not emit a call with an empty \`token_sets\`.`;
}

function buildTokensAutonomousPreamble(inputBlock: string): string {
  return `You are running as part of the experience-design-system-cli generate pipeline in AUTONOMOUS mode. The developer is not present to answer questions.

Your task: classify every raw token from the input below into a DTCG token tree. Apply all judgment calls yourself — do not pause to ask for confirmation. Include a "description" field on each set_token call to document your reasoning.

All input data is provided inline below — do not read any additional files.${inputBlock}

## Output protocol

Do NOT write any files or emit any JSON blobs. Instead, emit one JSON object per line to stdout for each token or group. The CLI reads your stdout line by line and writes each entry directly to the pipeline database.

The two tool calls you may emit are:

\`\`\`
{"tool":"set_group","path":"<dot.notation.path>","description":"<optional group description>"}

{"tool":"set_token","path":"<dot.notation.path>","type":"<DTCG type>","value":<value>,"description":"<reason>"}
\`\`\`

Rules:
- Emit exactly one JSON object per line. No multi-line JSON. No markdown fences.
- Emit a set_group call for every intermediate group node in the tree.
- Emit a set_token call for every leaf token.
- "path" is dot-notation, e.g. "colors.brand.primary" — no leading dots or slashes.
- "type" must be one of the 13 valid DTCG types: color, dimension, fontFamily, fontWeight, duration, cubicBezier, number, strokeStyle, border, transition, shadow, gradient, typography.
- "value" must be valid JSON (string, number, array, or object depending on the type). Do NOT wrap it in quotes if it is a complex type.
- Emit set_group calls before the set_token calls that fall under them.
- You may emit prose lines (not starting with {) anywhere — they are ignored by the parser and serve as your reasoning log.`;
}
