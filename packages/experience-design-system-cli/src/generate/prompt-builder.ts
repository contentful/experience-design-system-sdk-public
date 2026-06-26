import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `components` — classify component props; `tokens` — classify design tokens; `select` — decide whether a component belongs in Contentful Experience Orchestration */
export type Skill = 'components' | 'tokens' | 'select';
export type Mode = 'autonomous' | 'interactive';

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
};

const OUTPUT_FILES: Record<Skill, string> = {
  components: 'components.json',
  tokens: 'tokens.json',
  select: 'select.json',
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
    scss: 'scss',
    sass: 'scss',
    css: 'css',
    json: 'json',
    json5: 'json',
  };
  return map[ext] ?? 'text';
}

function buildPreamble(options: PromptOptions): string {
  const { skill, mode, rawComponentsInline, rawTokensInline, rawTokensFilename, tokensInline, tokenMapInline, outDir } =
    options;
  const outputFile = OUTPUT_FILES[skill];
  const outputPath = join(resolve(outDir), outputFile);

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

  const inputBlock = sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';

  if (mode === 'autonomous') {
    if (skill === 'components') {
      return buildComponentsAutonomousPreamble(inputBlock);
    }
    if (skill === 'select') {
      return buildSelectAutonomousPreamble(inputBlock);
    }
    return buildTokensAutonomousPreamble(inputBlock);
  } else {
    return `You are running as part of the experience-design-system-cli generate pipeline in INTERACTIVE mode. The developer is present and will answer your questions.

Your task: follow the skill instructions below, working collaboratively with the developer. Ask for confirmation on category corrections, prop exclusions, and grouping choices as the skill instructs.

All input data is provided inline below — do not read any additional files.${inputBlock}

Output:
Write the final ${outputFile} directly to: ${outputPath}`;
  }
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
{"tool":"classify_component","description":"<optional component-level description>"}

{"tool":"classify_prop","prop":"<propName>","cdf_type":"<type>","cdf_category":"<category>","required":<bool>,"description":"<short customer-facing description>","reason":"<full internal rationale; not customer-facing>","values":["a","b"],"token_kind":"color","default":"<value>"}

{"tool":"exclude_prop","prop":"<propName>","reason":"<why excluded>"}

{"tool":"classify_slot","slot":"<slotName>","required":<bool>,"allowed_components":["ComponentName"],"description":"<reason>"}
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
