import type { PromptOptions } from '../../types/prompts.js';

export function buildDebateSelectPreamble(options: PromptOptions, inputBlock: string): string {
  const role = options.debateRole ?? 'for';
  const existingModelSection = options.existingModelPath
    ? [
        '',
        '## Existing ExO model',
        '',
        `The already-imported components and design tokens are identified by this JSON path: \`${options.existingModelPath}\`. If that file is available in your execution context, use it as evidence about prior choices, not as the answer. Do not invent its contents when it is unavailable. When it conflicts with source evidence, the source wins; identify the existing component and property when you rely on it.`,
      ]
    : [];

  return [
    `You are the ${role.toUpperCase()} participant in a review of one component-selection disagreement. Do not ask the developer for confirmation.`,
    '',
    `Argue only the ${role.toUpperCase()} position on the exact disagreement below. Address the claim literally, cite supplied component evidence, and do not substitute a nearby component or field. Do not assume or describe another participant's response. Your output is an argument for a later independent determination, not a final selection.`,
    '',
    `Component and source data:${inputBlock}`,
    '',
    'Disagreement under review (JSON):',
    '~~~json',
    options.disagreementInline ?? '{}',
    '~~~',
    ...existingModelSection,
    '',
    '## Output protocol',
    '',
    'Emit exactly one JSON object on one line and do not write files:',
    '',
    '~~~json',
    `{"role":"${role}","disagreement_id":"<id>","argument":"<position and reasoning>","evidence":[{"source":"<path>","line":"<line-or-range>","quote":"<verbatim evidence>"}]}`,
    '~~~',
    '',
    'Use the role and disagreement ID supplied by the caller. Evidence must be an array of objects with source, line, and quote strings. Use an empty evidence array only when the supplied context contains no citable source evidence.',
  ].join('\n');
}
