import { loadPrompt } from './load-prompt.js';

/**
 * Build the prompt that asks the agent to WRITE a pure parser function (spec:
 * agent-authored-parser, Phase 2) rather than list edges. The static
 * instruction + contract live in `prompts/composition-parser.md`; this
 * appends the dynamic candidate files + component names. The authored parser
 * runs in the sandbox (sandbox.ts), so the contract forbids all I/O.
 */

const PROMPT_FILE = 'composition-parser.md';

export function buildAuthorPrompt(
  files: Array<{ path: string; content: string }>,
  componentNames: string[],
  instructionOverride?: string,
): string {
  const fileBlocks = files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
  const instruction = instructionOverride?.trim() ? instructionOverride.trim() : loadPrompt(PROMPT_FILE).trim();
  return [
    instruction,
    '',
    'Component names (use ONLY these):',
    componentNames.join(', '),
    '',
    'Candidate files:',
    fileBlocks,
  ].join('\n');
}
