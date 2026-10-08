export function buildSelectPreamble(inputBlock: string): string {
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
