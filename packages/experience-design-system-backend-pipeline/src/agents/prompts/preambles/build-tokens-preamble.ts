export function buildTokensPreamble(inputBlock: string): string {
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
