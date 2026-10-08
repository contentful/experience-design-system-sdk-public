export function buildComponentsAutonomousPreamble(inputBlock: string): string {
  return `You are running as part of the experience-design-system-cli generate pipeline in AUTONOMOUS mode. The developer is not present to answer questions.

Context: You are classifying a React component for **Contentful Experience Orchestration**. The result is a Component Type — a schema that tells Contentful what a marketer can configure. Properties fall into three categories:
- **design**: controls how the component looks (variant, size, color, layout toggles)
- **content**: the data a content editor fills in (text, images, URLs, rich text)
- **state**: runtime behavioral flags (disabled, loading, expanded, identifiers)

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
- For enum type, always include \`values\` (non-empty string array of the variant names the prop accepts).
- For token type, always include \`token_kind\` (DTCG \$type, e.g. "color"). **Never emit \`values\` for \`cdf_type: "token"\` props** — an enum prop's list holds variant names; a token prop's list holds design token paths, produced separately and never by you. Emitting \`values\` on a token prop makes the definition invalid.
- Never emit both "values" and "token_kind" on one prop.
- \`enum\` vs \`token\` is decided by three questions answered in order from the source shown — never from the TypeScript type. Q1: does the component look the value up, switch on it, or have a vocabulary for it (\`tokens[x]\`, \`switch (variant)\`, \`allowedValues\`)? yes → \`enum\`, stop.
- Q2: is the value written straight into a style or attribute (\`rx={radius}\`, \`padding: \${padding}\`)? no → not \`token\`, apply the type rules.
- Q3: is there a design-token reference at that use — a \`tokens.*\` parameter default, a \`tokenReference\`, an inline \`tokens.*\` / \`var(--*)\`? yes → \`token\` (cite both lines in "reason"); no → \`string\`. "Ambiguity resolves to \`enum\`" applies only when Q1–Q3 cannot be answered from the source shown.
- CSS design props (className, style, styles, positional/geometric props: top, bottom, left, right, rotation, offset, etc.) → classify_prop, cdf_type: "string", cdf_category: "design".
- For \`classify_slot.allowed_components\`, use only exact names from the hard allowlist provided below. Never invent a child from an import, JSX element, type name, icon name, or implementation helper; if a child is not listed, omit it.
- On classify_component, "rationale" fields are operator-facing (read-only) but may surface in customer-facing exports. The "rationale.description" field is subject to the description content rules in the skill prompt (no internal initiative names). "rationale.props" and "rationale.slots" describe your reasoning about scope; "classify_slot.rationale" explains why each slot was kept.
- On classify_prop, "reason" is REQUIRED and is the LLM's internal rationale — shown to the developer reviewing the import, never to end-users. "description" is the customer-facing copy and is subject to the description content rules in the skill prompt. Keep them distinct: "description" is short and customer-facing; "reason" explains your reasoning in detail.
- You may emit prose lines (not starting with {) anywhere — they are ignored by the parser and serve as your reasoning log.`;
}

export function buildSelectAutonomousPreamble(inputBlock: string): string {
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

export function buildMapTokensAutonomousPreamble(inputBlock: string): string {
  return `You are running as part of the experience-design-system-cli generate pipeline in AUTONOMOUS mode. The developer is not present to answer questions.

Context: The components below already have design-category, token-typed props (\`$token.kind\` set). Your task is to decide, from source evidence, whether to narrow each one to a restricted subset (\`token_allowed\`) of the tokens matching its \`$token.kind\`. Apply all judgment calls yourself — do not pause to ask for confirmation.

All input data is provided inline below — do not read any additional files.${inputBlock}

## Output protocol

Do NOT write any files or emit any JSON blobs. Instead, emit one JSON object per line to stdout for each prop you narrow. The CLI reads your stdout line by line and writes each decision directly to the pipeline database.

The one tool call you may emit:

\`\`\`
{"tool":"map_token_prop","component":"<ComponentName>","prop":"<propName>","token_allowed":["colors.brand.primary","colors.brand.secondary"]}
\`\`\`

Rules:
- Emit exactly one JSON object per line. No multi-line JSON. No markdown fences around the lines.
- Only emit a call for a prop that appears in the "Generated CDF so far" section.
- Each "Token path index" section below is already scoped to one \`$token.kind\` — a prop only draws candidates from the section matching its own \`$token.kind\` (or the "full tree" section, for a prop with no \`$token.kind\`). Never cross sections, never emit a group/prefix path, and never invent a path — every entry in \`token_allowed\` must exist verbatim in the matching section.
- \`token_allowed\` is required and must be non-empty when the call is emitted.
- For the judgment call of whether a prop should be narrowed at all, follow the decision tree in the map-tokens skill file: it explains defaults vs. restrictions, misclassified variant-name props, and when to emit nothing.
- You may emit prose lines (not starting with \`{\`) anywhere — they are ignored by the parser and serve as your reasoning log.`;
}

export function buildTokensAutonomousPreamble(inputBlock: string): string {
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
