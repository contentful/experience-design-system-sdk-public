export const PREFERENCE_OPTIONS = [
  { key: 'autoFilter', number: 1, label: 'AI auto-filter' },
  { key: 'concurrency', number: 2, label: 'Performance concurrency' },
  { key: 'customPrompts', number: 3, label: 'Custom prompts' },
  { key: 'debug', number: 4, label: 'Debug logging' },
  { key: 'analytics', number: 5, label: 'Usage analytics' },
  { key: 'noColor', number: 6, label: 'Disable terminal colors' },
] as const;

export type PreferenceKey = (typeof PREFERENCE_OPTIONS)[number]['key'];

export function parsePreferenceSelection(input: string): PreferenceKey[] | undefined {
  const selection = input.trim().toLowerCase();

  if (selection === '' || selection === 's') return [];
  if (selection === 'all') return PREFERENCE_OPTIONS.map((option) => option.key);

  const selectedNumbers = selection.split(',').map((token) => token.trim());
  if (selectedNumbers.some((token) => !/^\d+$/.test(token))) return undefined;

  const numbers = new Set(selectedNumbers.map(Number));
  if (
    numbers.size === 0 ||
    [...numbers].some((number) => !PREFERENCE_OPTIONS.some((option) => option.number === number))
  ) {
    return undefined;
  }

  return PREFERENCE_OPTIONS.filter((option) => numbers.has(option.number)).map((option) => option.key);
}

/** The picker list shown before any individual preference is configured. */
export function formatPreferencePicker(): string {
  return [
    'Choose preferences to configure:',
    ...PREFERENCE_OPTIONS.map((option) => `  [${option.number}] ${option.label}`),
    '  [all] Configure all',
    '  [s] Skip',
  ].join('\n');
}
