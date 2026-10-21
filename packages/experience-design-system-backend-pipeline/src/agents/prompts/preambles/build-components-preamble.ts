export function buildComponentsPreamble(inputBlock: string): string {
  return `You are running as part of the experience-design-system-cli generate pipeline in AUTONOMOUS mode. The developer is not present to answer questions.

Context: You are classifying a source component for **Contentful Experience Orchestration**. The result is a Component Type — a schema that tells Contentful what a marketer can configure. Properties fall into three categories:
- **design**: controls how the component looks (variant, size, color, layout toggles)
- **content**: the data a content editor fills in (text, images, URLs, rich text)
- **state**: runtime behavioral flags (disabled, loading, expanded, identifiers)

Your task: classify every prop and slot in the component below. Apply all judgment calls yourself — do not pause to ask for confirmation. Include a "description" field on each tool call to document your reasoning so the developer can review it afterward.

All source evidence is supplied inline or through invocation-owned artifacts. Source paths are citation labels, not filesystem permissions. You may read a supplied prompt/evidence artifact and execute only the exact supplied read-only representation validator command, passing draft JSON tool-call lines on stdin. Do not modify files or read/execute the live repository/source. If the selected agent has no shell tool, inspect host feedback and emit corrected decisions; host validation remains authoritative.${inputBlock}

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
- Root array and record definitions carry complete recursive \`items\` / \`fields\` metadata using CDF \`$type\`, \`$required\`, \`$description\`, \`$values\`, \`$items\` and \`$fields\`; preserve exact own keys and true/false requiredness at every node.
- Defaults are typed JSON values; omit them when unknown, use \`default_intent: {"action":"clear"}\` to clear a decision, and never execute source expressions or narrow a declared domain from observed/default values.
- Source graphs and defaults remain independent of advisory shape/category/representation; unsupported deeper or cyclic positions retain source evidence and require an explicit plan with unknown mapper/cardinality context.
- Proposal stdout is staged typed drafts only; caller readiness and activation are separate.
- Account for every independent inventory input exactly once, including inputs absent from advisory props: classify_prop, reasoned exclude_prop, or its accepted source-owned slot.
- The host-owned required decision inventory defines the exact property and slot subjects, including properties absent from advisory props. A matching slot name does not account for a property without an explicit sourceInput association.
- Unresolved representation uses a reasoned classify_prop with the required cdf_category (content, design or state), without cdf_type or representation companions; retain semantics and held readiness without inventing String.
- Without cdf_type, omit required, values, token_kind, default, default_intent, items and fields; source requiredness and defaults remain in the independent evidence.
- Emit exactly one classify_component, including components with no properties.
- Corrections supply only reported missing/rejected decisions and pending representation repairs; preserve successful decisions, retained semantics and source identity from this invocation.
- Absent default intent preserves the original source default; generated set/clear may not change a known source default.
- Every slot in the input must have exactly one classify_slot call.
- Valid cdf_type values: string, number, boolean, array, record, richtext, media, link, token
- Valid cdf_category values: content, design, state
- Finite string and number domains use typed \`values\`; enum is not a supported type.
- For token type, always include \`token_kind\` (DTCG \$type, e.g. "color"). **Never emit \`values\` for \`cdf_type: "token"\` props** — an enum prop's list holds variant names; a token prop's list holds design token paths, produced separately and never by you. Emitting \`values\` on a token prop makes the definition invalid.
- Never emit both "values" and "token_kind" on one prop.
- Preserve source-declared alternatives, requiredness, defaults and open domains. A name, shape, framework, caller or lookup does not prove a complete domain.
- When reconciled exploration judgments are supplied, carry forward compatible judgments and focus on CDF representation and validation; explain any departure using current evidence in reason or rationale.
- Consensus is advisory; distinguish checked resolutions from conflicting checks, single-reporter claims and interpretive hypotheses, and retain unresolved representation requirements explicitly.
- Use string with declared values only for complete source-supported finite sets; use token only when the source consumes a resolved token value. Keep unrepresented alternatives explicit for review.
- For \`classify_slot.allowed_components\`, use only exact names from the hard allowlist provided below. Never invent a child from an import, JSX element, type name, icon name, or implementation helper; if a child is not listed, omit it.
- On classify_component, "rationale" fields are operator-facing (read-only) but may surface in customer-facing exports. The "rationale.description" field is subject to the description content rules in the skill prompt (no internal initiative names). "rationale.props" and "rationale.slots" describe your reasoning about scope; "classify_slot.rationale" explains why each slot was kept.
- On classify_prop, "reason" is REQUIRED and is the LLM's internal rationale — shown to the developer reviewing the import, never to end-users. "description" is the customer-facing copy and is subject to the description content rules in the skill prompt. Keep them distinct: "description" is short and customer-facing; "reason" explains your reasoning in detail.
- You may emit prose lines (not starting with {) anywhere — they are ignored by the parser and serve as your reasoning log.`;
}
