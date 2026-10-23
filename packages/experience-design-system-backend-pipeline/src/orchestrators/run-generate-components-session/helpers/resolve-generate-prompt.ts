import { resolve } from 'node:path';
import { parsePromptOverrides } from '../../../agents/helpers/prompt-overrides/parse-prompt-overrides.js';
import { resolvePromptOverride } from '../../../agents/helpers/prompt-overrides/resolve-prompt-override.js';

export interface GeneratePromptOverride {
  path?: string;
  text?: string;
}

export async function resolveGeneratePrompt(overrides: string[]): Promise<GeneratePromptOverride> {
  const { overrides: parsed, errors } = parsePromptOverrides(overrides);
  if (errors.length > 0) throw new Error(errors.join('; '));
  const entry = parsed.get('generate');
  if (!entry) return {};
  const text = await resolvePromptOverride(entry);
  if (entry.kind === 'text') return { text };
  return { path: resolve(entry.value), text };
}
