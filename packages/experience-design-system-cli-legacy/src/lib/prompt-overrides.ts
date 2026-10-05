/**
 * Generic `--prompt <stage>=<value>` override parser.
 *
 * One repeatable flag overrides the prompt for any named pipeline stage
 * (e.g. `composition`, `select`, `generate`). The value is classified by
 * string SHAPE only — no filesystem access here: a value that looks like a
 * path is resolved+read by the consumer; otherwise it is treated as the
 * literal prompt text. This keeps the parser pure and testable.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type PromptOverride = { kind: 'path'; value: string } | { kind: 'text'; value: string };

const PROMPT_FILE_EXTENSIONS = ['.md', '.txt', '.prompt'];

/**
 * Heuristic: does this value look like a file path (vs. literal prompt text)?
 * Path if it contains a path separator, starts with `~`, or ends with a known
 * prompt-file extension. Deliberately does NOT touch the filesystem.
 */
export function looksLikePath(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) return true;
  if (value.startsWith('~')) return true;
  const lower = value.toLowerCase();
  return PROMPT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export type ParsePromptOverridesResult = {
  overrides: Map<string, PromptOverride>;
  errors: string[];
};

/**
 * Parse repeated `stage=value` flag inputs into a stage→override map. Splits on
 * the FIRST `=` so values may contain `=`. Last write wins for a repeated
 * stage. Malformed entries are collected in `errors` (caller decides fatality).
 */
export function parsePromptOverrides(inputs: string[]): ParsePromptOverridesResult {
  const overrides = new Map<string, PromptOverride>();
  const errors: string[] = [];

  for (const raw of inputs) {
    const eq = raw.indexOf('=');
    if (eq === -1) {
      errors.push(`--prompt "${raw}" must be in the form stage=value`);
      continue;
    }
    const stage = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1);
    if (stage === '') {
      errors.push(`--prompt "${raw}" has an empty stage (expected stage=value)`);
      continue;
    }
    if (value === '') {
      errors.push(`--prompt "${raw}" has an empty value`);
      continue;
    }
    overrides.set(stage, looksLikePath(value) ? { kind: 'path', value } : { kind: 'text', value });
  }

  return { overrides, errors };
}

/**
 * Resolve an override to its prompt text: read the file for a `path` override
 * (resolved against cwd), or return the literal `text` value. Throws with a
 * clear message if a path override can't be read.
 */
export async function resolvePromptOverride(override: PromptOverride): Promise<string> {
  if (override.kind === 'text') return override.value;
  const abs = resolve(override.value);
  try {
    return await readFile(abs, 'utf8');
  } catch {
    throw new Error(`--prompt: could not read prompt file: ${abs}`);
  }
}
