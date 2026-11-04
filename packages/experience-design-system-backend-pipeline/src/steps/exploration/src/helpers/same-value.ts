function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical).sort());
  if (value && typeof value === 'object')
    return JSON.stringify(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return JSON.stringify(value) ?? 'undefined';
}
export function sameValue(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}
