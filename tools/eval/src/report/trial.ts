import type { EvalResult, RunSummary } from '../types.js';

export type TrialRunResult = {
  summary: RunSummary;
  results: EvalResult[];
};

type Stat = { mean: number; stddev: number };

export type TrialBranchSummary = {
  branch: string;
  trials: number;
  avgCoverage: Stat;
  devPropLeakage: Stat;
  totalPropsOutput: Stat;
  avgMappingQuality: Stat | null;
  hallucinationFailures: Stat;
  /** Mean across trials of the aggregate DOM pass-through confusion matrix. */
  devPropConfusion: {
    truePositive: Stat;
    falseNegative: Stat;
    falsePositive: Stat;
    trueNegative: Stat;
    recall: Stat;
  };
  rawTrials: TrialRunResult[];
};

export type TrialReportOptions = {
  control: TrialBranchSummary;
  candidate: TrialBranchSummary;
  repoFilter?: string;
};

function fmt(stat: Stat | null, decimals = 3): string {
  if (!stat) return 'n/a';
  return `${stat.mean.toFixed(decimals)} ± ${stat.stddev.toFixed(decimals)}`;
}

function diff(candidate: Stat | null, control: Stat | null, decimals = 3): string {
  if (!candidate || !control) return 'n/a';
  const d = candidate.mean - control.mean;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(decimals)}`;
}

function pctFmt(stat: Stat): string {
  return `${(stat.mean * 100).toFixed(1)}% ± ${(stat.stddev * 100).toFixed(1)}pp`;
}

function pctDiff(candidate: Stat, control: Stat): string {
  const d = (candidate.mean - control.mean) * 100;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}pp`;
}

export function buildTrialReport(opts: TrialReportOptions): string {
  const { control, candidate, repoFilter } = opts;
  const lines: string[] = [];

  lines.push(`# DSI eval trial report`);
  lines.push('');
  lines.push(`- Control:    \`${control.branch}\`  (${control.trials} trials)`);
  lines.push(`- Candidate:  \`${candidate.branch}\`  (${candidate.trials} trials)`);
  if (repoFilter) lines.push(`- Scope:      single repo \`${repoFilter}\``);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Control | Candidate | Δ |');
  lines.push('|---|---|---|---|');
  lines.push(`| Coverage (avg) | ${pctFmt(control.avgCoverage)} | ${pctFmt(candidate.avgCoverage)} | ${pctDiff(candidate.avgCoverage, control.avgCoverage)} |`);
  lines.push(
    `| Dev-prop leakage | ${fmt(control.devPropLeakage, 1)} / ${fmt(control.totalPropsOutput, 0)} props | ${fmt(candidate.devPropLeakage, 1)} / ${fmt(candidate.totalPropsOutput, 0)} props | ${diff(candidate.devPropLeakage, control.devPropLeakage, 1)} props |`,
  );
  lines.push(
    `| Mapping quality (1–5) | ${fmt(control.avgMappingQuality, 2)} | ${fmt(candidate.avgMappingQuality, 2)} | ${diff(candidate.avgMappingQuality, control.avgMappingQuality, 2)} |`,
  );
  lines.push(
    `| Hallucination failures | ${fmt(control.hallucinationFailures, 1)} | ${fmt(candidate.hallucinationFailures, 1)} | ${diff(candidate.hallucinationFailures, control.hallucinationFailures, 1)} |`,
  );
  lines.push('');

  lines.push('## DOM pass-through classification — confusion matrix');
  lines.push('');
  lines.push(
    'Positive class = "the prop is a DOM/a11y/data-* pass-through that should be excluded from the CDF." Predicted positive = the pipeline excluded it.',
  );
  lines.push('');
  lines.push('| Outcome | Control | Candidate | Δ | Meaning |');
  lines.push('|---|---|---|---|---|');
  lines.push(
    `| TP (correct exclude) | ${fmt(control.devPropConfusion.truePositive, 1)} | ${fmt(candidate.devPropConfusion.truePositive, 1)} | ${diff(candidate.devPropConfusion.truePositive, control.devPropConfusion.truePositive, 1)} | DOM prop the pipeline correctly hid |`,
  );
  lines.push(
    `| FN (leak) | ${fmt(control.devPropConfusion.falseNegative, 1)} | ${fmt(candidate.devPropConfusion.falseNegative, 1)} | ${diff(candidate.devPropConfusion.falseNegative, control.devPropConfusion.falseNegative, 1)} | DOM prop that escaped to the editor — the customer pain |`,
  );
  lines.push(
    `| FP (over-exclude) | ${fmt(control.devPropConfusion.falsePositive, 1)} | ${fmt(candidate.devPropConfusion.falsePositive, 1)} | ${diff(candidate.devPropConfusion.falsePositive, control.devPropConfusion.falsePositive, 1)} | Non-DOM prop the pipeline excluded — includes legit excludes (callbacks, refs) so use as a sanity check |`,
  );
  lines.push(
    `| TN (correct include) | ${fmt(control.devPropConfusion.trueNegative, 1)} | ${fmt(candidate.devPropConfusion.trueNegative, 1)} | ${diff(candidate.devPropConfusion.trueNegative, control.devPropConfusion.trueNegative, 1)} | Non-DOM prop the pipeline kept |`,
  );
  lines.push(
    `| Recall | ${pctFmt(control.devPropConfusion.recall)} | ${pctFmt(candidate.devPropConfusion.recall)} | ${pctDiff(candidate.devPropConfusion.recall, control.devPropConfusion.recall)} | TP / (TP + FN) — share of DOM pass-through props correctly hidden |`,
  );
  lines.push('');

  lines.push('### Reading the table');
  lines.push('- All values are **mean ± stddev across trials**. With small N (typical 3), stddev is a rough variance indicator, not a confidence interval.');
  lines.push('- Δ is `candidate.mean − control.mean`. Positive Δ on coverage / quality is good; positive Δ on leakage / hallucinations is bad.');
  lines.push('- Bedrock calls are non-deterministic; some variance is expected even on identical inputs.');
  lines.push('');

  lines.push('## Per-trial raw');
  lines.push('');
  lines.push('### Control — ' + control.branch);
  for (let i = 0; i < control.rawTrials.length; i++) {
    const s = control.rawTrials[i].summary;
    lines.push(
      `- Trial ${i + 1}: coverage=${(s.avgComponentCoverage * 100).toFixed(1)}%, leakage=${s.devPropLeakageTotal}/${s.totalPropsOutput}, mapping=${s.avgMappingQuality?.toFixed(2) ?? 'n/a'}, halluc=${s.hallucinationFailures}`,
    );
  }
  lines.push('');
  lines.push('### Candidate — ' + candidate.branch);
  for (let i = 0; i < candidate.rawTrials.length; i++) {
    const s = candidate.rawTrials[i].summary;
    lines.push(
      `- Trial ${i + 1}: coverage=${(s.avgComponentCoverage * 100).toFixed(1)}%, leakage=${s.devPropLeakageTotal}/${s.totalPropsOutput}, mapping=${s.avgMappingQuality?.toFixed(2) ?? 'n/a'}, halluc=${s.hallucinationFailures}`,
    );
  }
  lines.push('');

  lines.push('## Top candidate false positives (LLM-driven over-excludes)');
  lines.push('');
  lines.push(
    'Non-DOM props the pipeline excluded that pre-classify did **not** pre-emptively exclude — these are over-exclusions the LLM made on its own, the most useful signal for prompt refinement. Capped at 30 most frequent.',
  );
  lines.push('');
  lines.push('| Prop | Occurrences | Sample components |');
  lines.push('|---|---|---|');

  const fpFreq = new Map<string, { count: number; samples: Array<{ component: string; repo: string }> }>();
  for (const trial of candidate.rawTrials) {
    for (const r of trial.results) {
      const fps = r.devPropLeakage?.falsePositives ?? [];
      for (const fp of fps) {
        if (fp.preClassifyExcluded) continue;
        if (!fpFreq.has(fp.prop)) fpFreq.set(fp.prop, { count: 0, samples: [] });
        const entry = fpFreq.get(fp.prop)!;
        entry.count++;
        if (entry.samples.length < 3) entry.samples.push({ component: fp.component, repo: r.repo });
      }
    }
  }
  const topFps = [...fpFreq.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 30);
  if (topFps.length === 0) {
    lines.push('| _none_ | — | — |');
  } else {
    for (const [prop, info] of topFps) {
      const samples = info.samples.map((s) => `${s.repo}/${s.component}`).join(', ');
      lines.push(`| \`${prop}\` | ${info.count} | ${samples} |`);
    }
  }
  lines.push('');
  lines.push('See the `*-false-positives.json` sidecar for the full list with raw types and trial indexes — feed it to the prompt-refinement agent.');
  lines.push('');

  lines.push('## Per-repo dev-prop leakage (control trial 1 vs candidate trial 1)');
  lines.push('');
  lines.push('| Repo | Control leakage | Candidate leakage |');
  lines.push('|---|---|---|');
  const ctrl0 = control.rawTrials[0]?.results ?? [];
  const cand0 = candidate.rawTrials[0]?.results ?? [];
  const repoToLeak = (results: EvalResult[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of results) m.set(r.repo, r.devPropLeakage?.leaked ?? 0);
    return m;
  };
  const ctrlMap = repoToLeak(ctrl0);
  const candMap = repoToLeak(cand0);
  const allRepos = new Set<string>([...ctrlMap.keys(), ...candMap.keys()]);
  for (const repo of [...allRepos].sort()) {
    lines.push(`| ${repo} | ${ctrlMap.get(repo) ?? '—'} | ${candMap.get(repo) ?? '—'} |`);
  }
  lines.push('');

  return lines.join('\n');
}
