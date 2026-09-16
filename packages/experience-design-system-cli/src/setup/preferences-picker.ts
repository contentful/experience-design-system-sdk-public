export const PREFERENCE_OPTIONS = [
  { key: 'autoFilter', label: 'AI auto-filter' },
  { key: 'concurrency', label: 'Performance concurrency' },
  { key: 'customPrompts', label: 'Custom prompts' },
  { key: 'debug', label: 'Debug logging' },
  { key: 'analytics', label: 'Usage analytics' },
  { key: 'noColor', label: 'Disable terminal colors' },
] as const;

export type PreferenceKey = (typeof PREFERENCE_OPTIONS)[number]['key'];
