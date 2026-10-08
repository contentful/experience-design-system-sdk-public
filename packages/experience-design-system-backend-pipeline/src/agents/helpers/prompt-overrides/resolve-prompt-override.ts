import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PromptOverride } from './parse-prompt-overrides.js';

/** Return the prompt text for an override: read the file (path) or return the literal (text). */
export async function resolvePromptOverride(override: PromptOverride): Promise<string> {
  if (override.kind === 'text') return override.value;
  const abs = resolve(override.value);
  try {
    return await readFile(abs, 'utf8');
  } catch {
    throw new Error(`--prompt: could not read prompt file: ${abs}`);
  }
}
