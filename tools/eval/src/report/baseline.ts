import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { BaselineEntry, BaselineComparison, EvalResult } from '../types.js';

const BaselineSchema = z.object({
  savedAt: z.string(),
  entries: z.array(z.object({
    repo: z.string(),
    componentCoverageRatio: z.number(),
    hallucinationPass: z.boolean(),
    mappingQualityScore: z.number().optional(),
  })),
});

type Baseline = z.infer<typeof BaselineSchema>;

export async function loadBaseline(path: string): Promise<Map<string, BaselineEntry> | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = BaselineSchema.parse(JSON.parse(raw));
    return new Map(parsed.entries.map((e) => [e.repo, e]));
  } catch {
    return null;
  }
}

export async function saveBaseline(path: string, results: EvalResult[]): Promise<void> {
  const baseline: Baseline = {
    savedAt: new Date().toISOString(),
    entries: results
      .filter((r) => !r.error && r.componentCoverage)
      .map((r) => ({
        repo: r.repo,
        componentCoverageRatio: r.componentCoverage!.ratio,
        hallucinationPass: r.hallucination?.pass ?? true,
        mappingQualityScore: r.judgeScore?.mapping_quality.score,
      })),
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(baseline, null, 2));
}

export function compareToBaseline(
  result: EvalResult,
  baseline: Map<string, BaselineEntry>,
): BaselineComparison | undefined {
  const prev = baseline.get(result.repo);
  if (!prev || !result.componentCoverage) return undefined;

  const coverageDelta = result.componentCoverage.ratio - prev.componentCoverageRatio;
  const mappingDelta =
    result.judgeScore && prev.mappingQualityScore !== undefined
      ? result.judgeScore.mapping_quality.score - prev.mappingQualityScore
      : null;

  const regressions: string[] = [];
  if (coverageDelta < -0.05) regressions.push(`component-coverage dropped ${(coverageDelta * 100).toFixed(1)}%`);
  if (mappingDelta !== null && mappingDelta < -1) regressions.push(`mapping-quality dropped ${mappingDelta} points`);

  return { coverageDelta, mappingDelta, regressions };
}
