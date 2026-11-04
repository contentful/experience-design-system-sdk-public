import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_FILES } from '../constants/skill-files.js';
import type { Skill } from '../types/prompts.js';

export function resolveSkillPath(skill: Skill): string {
  if (!(skill in SKILL_FILES)) throw new Error(`Invalid skill: ${skill}`);
  const file = SKILL_FILES[skill];
  const stepDir = skill.startsWith('explore-')
    ? 'explore'
    : ['tier', 'verify', 'check'].includes(skill)
      ? 'consensus'
      : file === 'select-components.md' || file === 'debate-select.md'
        ? 'selection'
        : 'generation';
  // The CLI carries primary assets; standalone backend builds carry grouped fallbacks.
  const relativePaths = [
    ...new Set([skill.startsWith('explore-') ? join('explore', file) : file, join(stepDir, file)]),
  ];
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  for (;;) {
    for (const relativePath of relativePaths) {
      const candidate = join(dir, 'skills', relativePath);
      if (existsSync(candidate)) return candidate;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(`skill file missing from package (could not locate ${file} in skills/ from: ${thisDir})`);
    }
    dir = parent;
  }
}
