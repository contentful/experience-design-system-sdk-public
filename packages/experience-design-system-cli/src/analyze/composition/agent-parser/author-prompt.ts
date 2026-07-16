/**
 * Build the prompt that asks the agent to WRITE a pure parser function (spec:
 * agent-authored-parser, Phase 2) rather than list edges. The authored parser
 * runs in the sandbox (sandbox.ts), so the contract forbids all I/O — it must
 * derive edges purely from the `ctx` it is given.
 */

const DEFAULT_AUTHOR_INSTRUCTION = [
  'You are writing a JavaScript function that extracts parent→child component composition from a design system.',
  'Study the candidate files below, identify the convention that expresses composition (e.g. a mapping layer,',
  'typed slots, a `withParentType`/`requiredParent`/`allowedTagNames` declaration), and write ONE pure function',
  'that parses that convention.',
  '',
  'STRICT RULES:',
  '1. Derive edges ONLY from evidence in ctx.files. Do not infer from naming, category, or convention.',
  '2. The function is PURE: no require, no import, no I/O, no network, no fs, no process — it may only read `ctx`.',
  '   (It runs in a locked sandbox; any capability access throws and the run is discarded.)',
  '3. Emit each parent→child pair at most once; both endpoints MUST be in ctx.componentNames.',
  '4. Prefer a smaller, fully-evidenced result over padding with plausible-but-unstated edges.',
] as const;

const CONTRACT = [
  'Return your answer as a single fenced code block containing exactly this shape:',
  '',
  '```js',
  'export default function (ctx) {',
  '  // ctx.files: { path: string, content: string }[]',
  '  // ctx.componentNames: string[]  (use ONLY these exact names)',
  '  const edges = [];',
  '  // ...parse ctx.files, push { parent, child, slot?, confidence? } objects...',
  '  return edges; // Array<{ parent: string, child: string, slot?: string, confidence?: 1-5 }>',
  '}',
  '```',
] as const;

export function buildAuthorPrompt(
  files: Array<{ path: string; content: string }>,
  componentNames: string[],
  instructionOverride?: string,
): string {
  const fileBlocks = files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
  const instruction = instructionOverride?.trim() ? instructionOverride.trim() : DEFAULT_AUTHOR_INSTRUCTION.join('\n');
  return [
    instruction,
    '',
    ...CONTRACT,
    '',
    'Component names (use ONLY these):',
    componentNames.join(', '),
    '',
    'Candidate files:',
    fileBlocks,
  ].join('\n');
}
