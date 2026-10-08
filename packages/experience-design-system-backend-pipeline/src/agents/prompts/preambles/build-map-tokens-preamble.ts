export function buildMapTokensPreamble(inputBlock: string): string {
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
