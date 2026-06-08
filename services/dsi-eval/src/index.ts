import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './corpus/loader.js';
import { runStage1 } from './runner/stage1.js';
import { runStage2 } from './runner/stage2.js';
import { scoreComponentCoverage, scoreHallucination } from './scorers/deterministic.js';
import { scoreMappingQuality } from './scorers/judge.js';
import { loadBaseline, saveBaseline, compareToBaseline } from './report/baseline.js';
import { buildMarkdownReport } from './report/markdown.js';
import type { EvalResult, RunSummary } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(__dirname, '..', 'baseline.json');

const args = process.argv.slice(2);
const saveBaselineFlag = args.includes('--save-baseline');
const repoFilter = args.find((a) => a.startsWith('--repo='))?.split('=')[1];

async function runEval() {
  console.log('Loading corpus...');
  const corpus = await loadCorpus(repoFilter);
  console.log(`Running eval on ${corpus.length} repo(s)...\n`);

  const baseline = await loadBaseline(BASELINE_PATH);
  if (baseline) {
    console.log('Baseline loaded — comparisons will be shown.\n');
  } else {
    console.log('No baseline found — run with --save-baseline after first run to create one.\n');
  }

  const results: EvalResult[] = [];

  for (const entry of corpus) {
    console.log(`[${entry.repo}] Running Stage 1 (select)...`);
    const result: EvalResult = {
      repo: entry.repo,
      cdf: null,
      componentCoverage: null,
      hallucination: null,
    };

    try {
      const { accepted } = await runStage1(entry.rawComponents);
      console.log(`[${entry.repo}] Stage 1 done — ${accepted.length}/${entry.rawComponents.length} accepted`);

      console.log(`[${entry.repo}] Running Stage 2 (generate)...`);
      result.cdf = await runStage2(accepted);
      console.log(`[${entry.repo}] Stage 2 done`);
    } catch (err) {
      result.error = {
        stage: result.cdf === null ? 'stage1' : 'stage2',
        message: err instanceof Error ? err.message : String(err),
      };
      results.push(result);
      console.error(`[${entry.repo}] ❌ Error: ${result.error.message}`);
      continue;
    }

    try {
      result.componentCoverage = scoreComponentCoverage(result.cdf, entry);
      result.hallucination = scoreHallucination(result.cdf);
      console.log(`[${entry.repo}] coverage=${(result.componentCoverage.ratio * 100).toFixed(1)}% hallucination=${result.hallucination.pass ? 'pass' : 'FAIL'}`);
    } catch (err) {
      result.error = { stage: 'score', message: err instanceof Error ? err.message : String(err) };
      results.push(result);
      continue;
    }

    try {
      console.log(`[${entry.repo}] Running judge scorer...`);
      result.judgeScore = await scoreMappingQuality(result.cdf, entry);
      console.log(`[${entry.repo}] mapping-quality=${result.judgeScore.mapping_quality.score}/5`);
    } catch (err) {
      result.error = { stage: 'judge', message: err instanceof Error ? err.message : String(err) };
    }

    if (baseline) {
      result.baselineComparison = compareToBaseline(result, baseline);
    }

    results.push(result);
  }

  const scored = results.filter((r) => !r.error && r.componentCoverage);
  const summary: RunSummary = {
    runAt: new Date().toISOString(),
    totalEntries: results.length,
    errorCount: results.filter((r) => r.error).length,
    avgComponentCoverage: scored.length
      ? scored.reduce((sum, r) => sum + r.componentCoverage!.ratio, 0) / scored.length
      : 0,
    hallucinationFailures: results.filter((r) => r.hallucination && !r.hallucination.pass).length,
    avgMappingQuality: scored.some((r) => r.judgeScore)
      ? scored
          .filter((r) => r.judgeScore)
          .reduce((sum, r) => sum + r.judgeScore!.mapping_quality.score, 0) /
        scored.filter((r) => r.judgeScore).length
      : null,
    baselineLoaded: baseline !== null,
    regressions: results.filter((r) => r.baselineComparison?.regressions.length).length,
  };

  const report = buildMarkdownReport(results, summary);
  const reportPath = resolve(__dirname, '..', `eval-report-${Date.now()}.md`);
  await writeFile(reportPath, report);
  console.log(`\nReport written to: ${reportPath}`);

  if (saveBaselineFlag) {
    await saveBaseline(BASELINE_PATH, results);
    console.log('Baseline saved.');
  }

  console.log(`\nSummary:`);
  console.log(`  Avg coverage:    ${(summary.avgComponentCoverage * 100).toFixed(1)}%`);
  console.log(`  Hallucinations:  ${summary.hallucinationFailures} failure(s)`);
  if (summary.avgMappingQuality !== null) {
    console.log(`  Mapping quality: ${summary.avgMappingQuality.toFixed(2)}/5`);
  }
  if (summary.baselineLoaded) {
    console.log(`  Regressions:     ${summary.regressions}`);
  }
}

runEval().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});
