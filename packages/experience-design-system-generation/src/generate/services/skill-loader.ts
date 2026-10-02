import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Skill } from '../model/prompt.js';

const SKILL_FILES: Record<Skill, string> = {
  components: 'generate-components.md',
  tokens: 'generate-tokens.md',
  select: 'select-components.md',
  'map-tokens': 'map-tokens.md',
};

export function resolveSkillPath(skill: Skill): string {
  if (!(skill in SKILL_FILES)) throw new Error(`Invalid skill: ${skill}`);
  // Walk up until we find the skills/ directory (works from both src/ and dist/src/ contexts)
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  for (;;) {
    const candidate = join(dir, 'skills');
    if (existsSync(candidate)) return join(candidate, SKILL_FILES[skill]);
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(`skill file missing from CLI installation (could not locate skills/ directory from: ${thisDir})`);
    }
    dir = parent;
  }
}

export async function loadSkillContent(skill: Skill, override?: string): Promise<string> {
  if (override) {
    const skillPath = resolve(override);
    try {
      return await readFile(skillPath, 'utf8');
    } catch {
      throw new Error(`custom prompt file not found (skill: ${skill}, path: ${skillPath})`);
    }
  }
  const skillPath = resolveSkillPath(skill);
  try {
    return await readFile(skillPath, 'utf8');
  } catch {
    throw new Error(`skill file missing from CLI installation — try reinstalling the CLI (looked for: ${skillPath})`);
  }
}
