import { looksLikePath } from './looks-like-path.js';

export type PromptOverride = { kind: 'path'; value: string } | { kind: 'text'; value: string };

export interface ParsePromptOverridesResult {
  overrides: Map<string, PromptOverride>;
  errors: string[];
}

/**
 * Parse repeated `stage=value` flag inputs into a stage→override map. Splits
 * on the FIRST `=` so values may contain `=`. Last write wins for a repeated
 * stage. Malformed entries land in `errors`.
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
