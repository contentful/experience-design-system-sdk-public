import type { SetupActionDependencies } from '../../lib/types.js';
import { configureAnalytics } from './analytics.js';
import { configureAutoFilter } from './auto-filter.js';
import { configureConcurrency } from './concurrency.js';
import { configureCustomPrompts } from './custom-prompts.js';
import { configureDebug } from './debug.js';
import { configureNoColor } from './no-color.js';

/**
 * The preferences the wizard walks, in the order it presents them. Each entry
 * pairs its label with the function that owns that setting's help text, prompt,
 * and persistence — so adding a preference means adding a file and a row here.
 */
export const PREFERENCE_OPTIONS = [
  { key: 'autoFilter', label: 'AI auto-filter', configure: configureAutoFilter },
  { key: 'concurrency', label: 'Performance concurrency', configure: configureConcurrency },
  { key: 'customPrompts', label: 'Custom prompts', configure: configureCustomPrompts },
  { key: 'debug', label: 'Debug logging', configure: configureDebug },
  { key: 'analytics', label: 'Usage analytics', configure: configureAnalytics },
  { key: 'noColor', label: 'Disable terminal colors', configure: configureNoColor },
] as const;

export type PreferenceKey = (typeof PREFERENCE_OPTIONS)[number]['key'];

export async function runPreferenceSetupAction(
  dependencies: SetupActionDependencies,
  profilePath: string,
): Promise<{ selected: PreferenceKey[] }> {
  for (const option of PREFERENCE_OPTIONS) {
    await option.configure(dependencies, profilePath);
  }
  return { selected: PREFERENCE_OPTIONS.map((option) => option.key) };
}
