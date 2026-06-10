import type { EvalResult, RunSummary } from '../types.js';

export function buildMarkdownReport(results: EvalResult[], summary: RunSummary): string {
  const lines: string[] = [];

  lines.push('# DSI Eval Report');
  lines.push(`\n_Run at: ${summary.runAt}_\n`);

  lines.push('## Summary\n');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Entries evaluated | ${summary.totalEntries} |`);
  lines.push(`| Errors | ${summary.errorCount} |`);
  lines.push(`| Avg component coverage | ${(summary.avgComponentCoverage * 100).toFixed(1)}% |`);
  lines.push(`| Hallucination failures | ${summary.hallucinationFailures} |`);
  if (summary.avgMappingQuality !== null) {
    lines.push(`| Avg mapping quality | ${summary.avgMappingQuality.toFixed(2)} / 5 |`);
  }
  if (summary.baselineLoaded) {
    lines.push(`| Regressions vs baseline | ${summary.regressions} |`);
  }

  if (summary.regressions > 0) {
    lines.push('\n## ⚠️ Regressions\n');
    for (const result of results) {
      if (result.baselineComparison?.regressions.length) {
        lines.push(`**${result.repo}**`);
        for (const r of result.baselineComparison.regressions) {
          lines.push(`- ${r}`);
        }
      }
    }
  }

  lines.push('\n## Per-repo results\n');

  for (const result of results) {
    lines.push(`### ${result.repo}\n`);

    if (result.error) {
      lines.push(`> ❌ Error during \`${result.error.stage}\`: ${result.error.message}\n`);
      continue;
    }

    if (result.componentCoverage) {
      const { ratio, found, expected, missed } = result.componentCoverage;
      lines.push(`**Component coverage:** ${(ratio * 100).toFixed(1)}% (${found}/${expected})`);
      if (missed.length) lines.push(`- Missed: ${missed.join(', ')}`);
    }

    if (result.hallucination) {
      lines.push(`\n**Hallucination check:** ${result.hallucination.pass ? '✅ pass' : '❌ fail'}`);
      if (!result.hallucination.pass) {
        for (const v of result.hallucination.violations) {
          lines.push(`- \`${v.component}.${v.prop}\`: invalid type \`${v.invalidType}\``);
        }
      }
    }

    if (result.judgeScore) {
      const { score, reason } = result.judgeScore.mapping_quality;
      lines.push(`\n**Mapping quality:** ${score}/5 — ${reason}`);
    }

    if (result.baselineComparison) {
      const { coverageDelta, mappingDelta } = result.baselineComparison;
      const coverageSign = coverageDelta >= 0 ? '+' : '';
      lines.push(`\n**vs baseline:** coverage ${coverageSign}${(coverageDelta * 100).toFixed(1)}%` +
        (mappingDelta !== null ? `, mapping ${mappingDelta >= 0 ? '+' : ''}${mappingDelta}` : ''));
    }

    lines.push('');
  }

  return lines.join('\n');
}
