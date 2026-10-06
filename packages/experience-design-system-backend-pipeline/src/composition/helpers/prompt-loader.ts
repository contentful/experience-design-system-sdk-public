import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolvePromptPath(fileName: string): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  for (;;) {
    const candidate = join(dir, 'prompts');
    if (existsSync(candidate)) return join(candidate, fileName);
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(
        `prompt file missing from package installation (could not locate prompts/ directory from: ${thisDir})`,
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
    throw new Error(
      `prompt file missing from package installation — try reinstalling (looked for: ${path})`,
    );
  }
}
