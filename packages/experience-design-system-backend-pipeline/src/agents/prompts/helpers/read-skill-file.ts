import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Skill } from '../../types/prompts.js';
import { resolveSkillPath } from '../resolve-skill-path.js';

export async function readSkillFile(skill: Skill, override?: string): Promise<string> {
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
    throw new Error(`skill file missing from package (expected at: ${skillPath})`);
  }
}
