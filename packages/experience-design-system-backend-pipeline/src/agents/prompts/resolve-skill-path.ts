import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_FILES } from '../constants/skill-files.js';
import type { Skill } from '../types/prompts.js';

export function resolveSkillPath(skill: Skill): string {
  if (!(skill in SKILL_FILES)) throw new Error(`Invalid skill: ${skill}`);
  // Walk up until we find the skills/ directory (works from both src/ and dist/src/ contexts)
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  for (;;) {
    const candidate = join(dir, 'skills');
    if (existsSync(candidate)) {
      // Each skill lives under skills/<step>/<file>; try every subdir until one hits.
      const file = SKILL_FILES[skill];
      const stepDir = file === 'select-components.md' ? 'selection' : 'generation';
      return join(candidate, stepDir, file);
    }
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(`skill file missing from package (could not locate skills/ directory from: ${thisDir})`);
    }
    dir = parent;
  }
}
