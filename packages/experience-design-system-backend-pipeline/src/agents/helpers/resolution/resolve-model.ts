/** flag value → stored creds value → undefined (no default; agent picks). */
export function resolveModel(flagValue: string | undefined, storedValue: string | undefined): string | undefined {
  if (flagValue && flagValue.length > 0) return flagValue;
  if (storedValue && storedValue.length > 0) return storedValue;
  return undefined;
}
