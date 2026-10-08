export function inferParamsShape(expected?: string): Record<string, unknown> | null {
  if (!expected) return null;
  try {
    return JSON.parse(expected) as Record<string, unknown>;
  } catch {
    return null;
  }
}
