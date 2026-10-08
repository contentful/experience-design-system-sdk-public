export function parsePrecomputedCachedNames(value: string | undefined): Set<string> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    return new Set(Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : []);
  } catch {
    return new Set();
  }
}
