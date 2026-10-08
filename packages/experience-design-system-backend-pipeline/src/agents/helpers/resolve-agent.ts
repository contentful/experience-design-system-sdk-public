const DEFAULT_AGENT = 'claude';

/** flag value → stored creds value → built-in default. */
export function resolveAgent(flagValue: string | undefined, storedValue: string | undefined): string {
  if (flagValue && flagValue.length > 0) return flagValue;
  if (storedValue && storedValue.length > 0) return storedValue;
  return DEFAULT_AGENT;
}
