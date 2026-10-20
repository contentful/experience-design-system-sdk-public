import type { ExtractionDiagnostics } from '../candidates/types.js';

function uniqueByJson<T>(values: readonly T[]): T[] {
  const unique = new Map(values.map((value) => [JSON.stringify(value), value]));
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

export function mergeExtractionDiagnostics(
  values: readonly (ExtractionDiagnostics | undefined)[],
): ExtractionDiagnostics | undefined {
  const available = values.filter((value): value is ExtractionDiagnostics => value !== undefined);
  if (available.length === 0) return undefined;

  const limits: Record<string, number> = {};
  const used: Record<string, number> = {};
  for (const diagnostic of available) {
    for (const [name, value] of Object.entries(diagnostic.limits))
      limits[name] = Math.min(limits[name] ?? value, value);
    for (const [name, value] of Object.entries(diagnostic.used)) used[name] = (used[name] ?? 0) + value;
  }

  return {
    schemaVersion: 1,
    projects: uniqueByJson(available.flatMap((item) => item.projects)),
    modules: uniqueByJson(available.flatMap((item) => item.modules)),
    references: uniqueByJson(available.flatMap((item) => item.references)),
    coverage: available.some((item) => item.coverage === 'unavailable')
      ? 'unavailable'
      : available.some((item) => item.coverage === 'partial')
        ? 'partial'
        : 'complete-within-declared-bound',
    limits,
    used,
  };
}
