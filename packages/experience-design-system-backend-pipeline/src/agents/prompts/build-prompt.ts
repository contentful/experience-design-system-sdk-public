import type { PromptOptions } from '../types/prompts.js';
import type { Skill } from '../types/prompts.js';
import { buildInputSections } from './helpers/build-input-sections.js';
import { readSkillFile } from './helpers/read-skill-file.js';
import { buildComponentsPreamble } from './preambles/build-components-preamble.js';
import { buildMapTokensPreamble } from './preambles/build-map-tokens-preamble.js';
import { buildSelectPreamble } from './preambles/build-select-preamble.js';
import { buildTokensPreamble } from './preambles/build-tokens-preamble.js';

/** One builder per skill. Add a new entry and TypeScript enforces exhaustiveness at the keyed access site. */
const PREAMBLE_BUILDERS: Record<Skill, (inputBlock: string) => string> = {
  components: buildComponentsPreamble,
  select: buildSelectPreamble,
  'map-tokens': buildMapTokensPreamble,
  tokens: buildTokensPreamble,
};

export async function buildPrompt(options: PromptOptions): Promise<string> {
  const skillContent = options.skillContentOverride ?? (await readSkillFile(options.skill, options.skillPathOverride));
  const preamble = buildSkillPreamble(options);
  return `${preamble}\n\nSkill instructions follow:\n---\n${skillContent}`;
}

function buildSkillPreamble(options: PromptOptions): string {
  const sections = buildInputSections(options);
  const inputBlock = sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';
  return PREAMBLE_BUILDERS[options.skill](inputBlock);
}
