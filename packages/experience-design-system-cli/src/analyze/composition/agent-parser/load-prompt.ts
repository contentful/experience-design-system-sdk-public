import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve a bundled prompt file from the package-root `prompts/` directory.
 * Walks up from this module so it works from both `src/` and `dist/src/`,
 * mirroring `resolveSkillPath` for the skills/ directory.
 */
export function resolvePromptPath(fileName: string): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  for (;;) {
    const candidate = join(dir, 'prompts');
    if (existsSync(candidate)) return join(candidate, fileName);
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(
        `prompt file missing from CLI installation (could not locate prompts/ directory from: ${thisDir})`,
      );
    }
    dir = parent;
  }
}

export function loadPrompt(fileName: string): string {
  const path = resolvePromptPath(fileName);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`prompt file missing from CLI installation — try reinstalling the CLI (looked for: ${path})`);
  }
}
