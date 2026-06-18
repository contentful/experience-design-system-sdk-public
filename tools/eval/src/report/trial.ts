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
