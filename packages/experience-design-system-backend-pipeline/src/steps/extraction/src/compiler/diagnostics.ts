import type { ExtractionDiagnostics, SourceCandidateCollection } from '../candidates/types.js';

function uniqueByJson<T>(values: readonly T[]): T[] {
  const unique = new Map(values.map((value) => [JSON.stringify(value), value]));
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
}

export function mergeExtractionDiagnostics(
  values: readonly (ExtractionDiagnostics | undefined)[],
): ExtractionDiagnostics | undefined {
  const available = uniqueByJson(values.filter((value): value is ExtractionDiagnostics => value !== undefined));
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
    reads: uniqueByJson(available.flatMap((item) => item.reads ?? [])),
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

export function recordSourceCandidateDiagnostics(
  diagnostics: ExtractionDiagnostics | undefined,
  sourcePath: string,
  componentName: string,
  result: SourceCandidateCollection,
): void {
  if (!diagnostics) return;
  const receipt = {
    specifier: `source-candidates:${componentName}`,
    fromPath: sourcePath,
    outcome: result.omittedCount ? ('unavailable' as const) : ('resolved' as const),
    reason: result.omittedCount ? `source-candidate-budget-exhausted:${result.omittedCount}` : null,
  };
  if (diagnostics.modules.some((item) => JSON.stringify(item) === JSON.stringify(receipt))) return;
  diagnostics.modules.push(receipt);
  diagnostics.limits.maxSourceCandidates = 2048;
  diagnostics.used.sourceCandidates = (diagnostics.used.sourceCandidates ?? 0) + result.candidates.length;
  diagnostics.used.sourceCandidatesOmitted = (diagnostics.used.sourceCandidatesOmitted ?? 0) + result.omittedCount;
  if (result.omittedCount) diagnostics.coverage = 'partial';
}
