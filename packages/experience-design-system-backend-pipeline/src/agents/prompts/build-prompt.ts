import {
  buildStructuredStagePreamble,
  buildStructuredStagePrompt,
} from './preambles/build-structured-stage-preamble.js';
import type { PromptOptions } from '../types/prompts.js';
import type { Skill } from '../types/prompts.js';
import { buildInputSections } from './helpers/build-input-sections.js';
import { readSkillFile } from './helpers/read-skill-file.js';
import { buildComponentsPreamble } from './preambles/build-components-preamble.js';
import { buildDebateSelectPreamble } from './preambles/build-debate-select-preamble.js';
import { buildMapTokensPreamble } from './preambles/build-map-tokens-preamble.js';
import { buildSelectPreamble } from './preambles/build-select-preamble.js';
import { buildTokensPreamble } from './preambles/build-tokens-preamble.js';

/** One builder per skill. Add a new entry and TypeScript enforces exhaustiveness at the keyed access site. */
const PREAMBLE_BUILDERS: Record<Skill, (options: PromptOptions, inputBlock: string) => string> = {
  components: (_options, inputBlock) => buildComponentsPreamble(inputBlock),
  select: (_options, inputBlock) => buildSelectPreamble(inputBlock),
  'map-tokens': (_options, inputBlock) => buildMapTokensPreamble(inputBlock),
  tokens: (_options, inputBlock) => buildTokensPreamble(inputBlock),
  'debate-select': buildDebateSelectPreamble,
  'explore-components': buildStructuredStagePreamble,
  'explore-inventory': buildStructuredStagePreamble,
  tier: buildStructuredStagePreamble,
  verify: buildStructuredStagePreamble,
  check: buildStructuredStagePreamble,
};

export async function buildPrompt(options: PromptOptions): Promise<string> {
  const skillContent = options.skillContentOverride ?? (await readSkillFile(options.skill, options.skillPathOverride));
  if (['explore-components', 'explore-inventory', 'tier', 'verify', 'check'].includes(options.skill)) {
    const { readFile } = await import('node:fs/promises');
    const { resolveSkillPath } = await import('./resolve-skill-path.js');
    const { dirname, join } = await import('node:path');
    const rulesPath = join(dirname(resolveSkillPath('explore-components')), 'rules.md');
    const rules = await readFile(rulesPath, 'utf8');
    return buildStructuredStagePrompt(options, `${rules}\n${skillContent}`, buildInputSections(options).join('\n\n'));
  }
  const preamble = buildSkillPreamble(options);
  return `${preamble}\n\nSkill instructions follow:\n---\n${skillContent}`;
}

function buildSkillPreamble(options: PromptOptions): string {
  const sections = buildInputSections(options);
  const inputBlock = sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';
  return PREAMBLE_BUILDERS[options.skill](options, inputBlock);
}
