import type { PromptOptions, Skill } from '../../types/prompt.js';
import { readSkillFile } from './helpers/resolve-skill-file.js';
import { buildPreamble } from './helpers/build-preamble.js';

export { resolveSkillPath, formatCustomPromptBanner } from './helpers/resolve-skill-file.js';
export type { Skill };

export async function buildPrompt(options: PromptOptions): Promise<string> {
  const skillContent = options.skillContentOverride ?? (await readSkillFile(options.skill, options.skillPathOverride));
  const preamble = buildPreamble(options);
  return `${preamble}\n\nSkill instructions follow:\n---\n${skillContent}`;
}
