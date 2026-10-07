import type { PromptOptions } from '../types/prompts.js';
import { buildInputSections } from './helpers/build-input-sections.js';
import { readSkillFile } from './helpers/read-skill-file.js';
import { buildComponentsPreamble } from './preambles/build-components-preamble.js';
import { buildMapTokensPreamble } from './preambles/build-map-tokens-preamble.js';
import { buildSelectPreamble } from './preambles/build-select-preamble.js';
import { buildTokensPreamble } from './preambles/build-tokens-preamble.js';

export async function buildPrompt(options: PromptOptions): Promise<string> {
  const skillContent = options.skillContentOverride ?? (await readSkillFile(options.skill, options.skillPathOverride));
  const preamble = buildSkillPreamble(options);
  return `${preamble}\n\nSkill instructions follow:\n---\n${skillContent}`;
}

function buildSkillPreamble(options: PromptOptions): string {
  const sections = buildInputSections(options);
  const inputBlock = sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';

  switch (options.skill) {
    case 'components':
      return buildComponentsPreamble(inputBlock);
    case 'select':
      return buildSelectPreamble(inputBlock);
    case 'map-tokens':
      return buildMapTokensPreamble(inputBlock);
    case 'tokens':
      return buildTokensPreamble(inputBlock);
  }
}
