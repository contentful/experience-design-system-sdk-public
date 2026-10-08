export function extractValue(input: unknown, path: string): string | undefined {
  if (path === '/') return undefined;
  const parts = path.split('/').filter(Boolean);
  let current: unknown = input;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined) return undefined;
  return typeof current === 'string' ? current : JSON.stringify(current);
}
