import type { StepDone } from '../StepLayout.js';
import { AnalyticsScreen } from './analytics.js';
import { AutoFilterScreen } from './auto-filter.js';
import { ConcurrencyScreen } from './concurrency.js';
import { CustomPromptsScreen } from './custom-prompts.js';
import { DebugScreen } from './debug.js';
import { NoColorScreen } from './no-color.js';

export type PreferenceScreenProps = {
  profilePath: string;
  onDone: StepDone;
};

/**
 * The preferences the wizard walks, in the order it presents them. Each entry
 * pairs its label with the screen that owns that setting's help text, prompt,
 * and persistence — so adding a preference means adding a file and a row here.
 */
export const PREFERENCE_OPTIONS = [
  {
    key: 'autoFilter',
    label: 'AI auto-filter',
    Screen: ({ onDone }: PreferenceScreenProps) => <AutoFilterScreen onDone={onDone} />,
  },
  {
    key: 'concurrency',
    label: 'Performance concurrency',
    Screen: ({ onDone }: PreferenceScreenProps) => <ConcurrencyScreen onDone={onDone} />,
  },
  {
    key: 'customPrompts',
    label: 'Custom prompts',
    Screen: ({ onDone }: PreferenceScreenProps) => <CustomPromptsScreen onDone={onDone} />,
  },
  {
    key: 'debug',
    label: 'Debug logging',
    Screen: ({ onDone }: PreferenceScreenProps) => <DebugScreen onDone={onDone} />,
  },
  {
    key: 'analytics',
    label: 'Usage analytics',
    Screen: ({ onDone }: PreferenceScreenProps) => <AnalyticsScreen onDone={onDone} />,
  },
  {
    key: 'noColor',
    label: 'Terminal colors',
    Screen: ({ profilePath, onDone }: PreferenceScreenProps) => (
      <NoColorScreen profilePath={profilePath} onDone={onDone} />
    ),
  },
] as const;

export type PreferenceKey = (typeof PREFERENCE_OPTIONS)[number]['key'];
