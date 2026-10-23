import { parsePromptOverrides } from '../../../agents/helpers/prompt-overrides/parse-prompt-overrides.js';
import { resolvePromptOverride } from '../../../agents/helpers/prompt-overrides/resolve-prompt-override.js';

/**
 * Resolve the `composition=` prompt override, if any, into a prompt string.
 * Throws when `promptOverrides` contains syntactic errors so the caller can
 * fail fast before any agent is invoked.
 */
export async function resolveCompositionPrompt(promptOverrides: string[]): Promise<string | undefined> {
  const { overrides, errors } = parsePromptOverrides(promptOverrides);
  if (errors.length > 0) throw new Error(`Prompt override error(s): ${errors.join('; ')}`);
  const compositionOverride = overrides.get('composition');
  return compositionOverride ? resolvePromptOverride(compositionOverride) : undefined;
}
