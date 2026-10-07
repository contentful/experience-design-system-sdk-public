import type { Skill } from '../types/prompts.js';

export const SKILL_FILES: Record<Skill, string> = {
  components: 'generate-components.md',
  tokens: 'generate-tokens.md',
  select: 'select-components.md',
  'map-tokens': 'map-tokens.md',
};
