/**
 * A/B trial harness for the DSI eval.
 *
 * Runs the eval N trials per branch (control + candidate) using git worktrees
 * so each trial sees the right version of skills/*.md and src/analyze/pre-classify.ts.
 * Aggregates results into a comparison report (mean ± stddev + diff per metric).
 *
 * Usage:
 *   pnpm trial \
 *     --control main \
 *     --candidate fix/integ-llm-exclude-dom-passthrough-props \
 *     --trials 3 \
 *     [--repo forma-36]   # optional: scope to one corpus entry
 *     [--keep-worktrees]  # don't auto-clean .eval-worktrees after the run
 *
 * Environment passthrough:
 *   DSI_EVAL_LLM_CLIENT, DSI_EVAL_CORPUS_REPO, AWS_PROFILE, AWS_REGION,
 *   BEDROCK_MODEL_ID — propagated to each subprocess unchanged.
 *
 * Cost note: each trial invokes ~22 repos × ~12 components × 2 stages of Bedrock
 * calls. With --trials 3 and 2 branches, that's ~6× the cost of a single eval run.
 * Use --repo to iterate on a single entry while developing.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildTrialReport } from '../src/report/trial.js';
import type { TrialRunResult, TrialBranchSummary } from '../src/report/trial.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(EVAL_DIR, '..', '..');
const WORKTREES_DIR = resolve(EVAL_DIR, '.eval-worktrees');

function sh(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
}

function ensureWorktree(branch: string): string {
  const slug = branch.replace(/[/]/g, '__');
  const path = resolve(WORKTREES_DIR, slug);
  mkdirSync(WORKTREES_DIR, { recursive: true });

  if (existsSync(path)) {
    // Refresh the existing worktree to the latest tip of the branch.
    sh('git', ['-C', path, 'fetch', 'origin', branch], REPO_ROOT);
    try {
      sh('git', ['-C', path, 'checkout', branch], REPO_ROOT);
    } catch {
      // branch may already be checked out
    }
    sh('git', ['-C', path, 'reset', '--hard', `origin/${branch}`], REPO_ROOT);
    return path;
  }

  console.log(`[worktree] creating ${slug} → ${branch}`);
  sh('git', ['worktree', 'add', '--force', path, branch], REPO_ROOT);
  return path;
}

function installAndBuild(worktreePath: string): void {
  console.log(`[worktree] pnpm install (${worktreePath})`);
  spawnSync('pnpm', ['install', '--prefer-offline'], {
    cwd: worktreePath,
    stdio: 'inherit',
  });
  // The eval and the workspace deps it imports compile from src/, so no build step
  // is strictly required. We do need the corpus pulled into the worktree's eval dir.
  pullCorpus(worktreePath);
}

function pullCorpus(worktreePath: string): void {
  // Reuse the pre-existing pull-corpus script. Idempotent: the script's git pull
  // is a no-op if already up to date.
  const evalDirInWt = resolve(worktreePath, 'tools/eval');
  if (!process.env.DSI_EVAL_CORPUS_REPO) {
    throw new Error('DSI_EVAL_CORPUS_REPO env var must be set (e.g. git@github.com:contentful/dsi-eval-data.git)');
  }
  // The pull-corpus script's final `cp .corpus-repo/corpus/*.json corpus/`
  // assumes corpus/ exists. In a fresh worktree it doesn't yet.
  mkdirSync(resolve(evalDirInWt, 'corpus'), { recursive: true });
  console.log(`[worktree] pull-corpus in ${evalDirInWt}`);
  const res = spawnSync('pnpm', ['pull-corpus'], {
    cwd: evalDirInWt,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`pull-corpus failed in ${evalDirInWt} (exit ${res.status})`);
  }
}

function runTrial(branch: string, worktreePath: string, trialIdx: number, repoFilter?: string): TrialRunResult {
  const evalDirInWt = resolve(worktreePath, 'tools/eval');
  const slug = branch.replace(/[/]/g, '__');
  const jsonOutPath = resolve(EVAL_DIR, `.eval-worktrees/results/${slug}-trial-${trialIdx}.json`);
  mkdirSync(dirname(jsonOutPath), { recursive: true });

  const args = ['start', '--', `--json-out=${jsonOutPath}`];
  if (repoFilter) args.push(`--repo=${repoFilter}`);

  console.log(`\n=== ${branch} · trial ${trialIdx + 1} ===`);
  const res = spawnSync('pnpm', args, {
    cwd: evalDirInWt,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`Trial ${trialIdx + 1} on ${branch} exited with status ${res.status}`);
  }

  const raw = readFileSync(jsonOutPath, 'utf8');
  return JSON.parse(raw) as TrialRunResult;
}

function summarizeBranch(branch: string, trials: TrialRunResult[]): TrialBranchSummary {
  const coverages = trials.map((t) => t.summary.avgComponentCoverage);
  const leakages = trials.map((t) => t.summary.devPropLeakageTotal);
  const totalProps = trials.map((t) => t.summary.totalPropsOutput);
  const judgeScores = trials.map((t) => t.summary.avgMappingQuality).filter((v): v is number => v !== null);
  const halluc = trials.map((t) => t.summary.hallucinationFailures);
  const tps = trials.map((t) => t.summary.devPropConfusion.truePositive);
  const fns = trials.map((t) => t.summary.devPropConfusion.falseNegative);
  const fps = trials.map((t) => t.summary.devPropConfusion.falsePositive);
  const tns = trials.map((t) => t.summary.devPropConfusion.trueNegative);
  const recalls = trials.map((t) => t.summary.devPropConfusion.recall);

  const costsWithData = trials.map((t) => t.summary.llmCost).filter((c): c is NonNullable<typeof c> => c != null);
  const llmCost =
    costsWithData.length > 0
      ? {
          inputTokens: { mean: mean(costsWithData.map((c) => c.inputTokens)), stddev: stddev(costsWithData.map((c) => c.inputTokens)) },
          outputTokens: { mean: mean(costsWithData.map((c) => c.outputTokens)), stddev: stddev(costsWithData.map((c) => c.outputTokens)) },
          estimatedUsd: { mean: mean(costsWithData.map((c) => c.estimatedUsd)), stddev: stddev(costsWithData.map((c) => c.estimatedUsd)) },
        }
      : undefined;

  return {
    branch,
    trials: trials.length,
    avgCoverage: { mean: mean(coverages), stddev: stddev(coverages) },
    devPropLeakage: { mean: mean(leakages), stddev: stddev(leakages) },
    totalPropsOutput: { mean: mean(totalProps), stddev: stddev(totalProps) },
    avgMappingQuality: judgeScores.length
      ? { mean: mean(judgeScores), stddev: stddev(judgeScores) }
      : null,
    hallucinationFailures: { mean: mean(halluc), stddev: stddev(halluc) },
    devPropConfusion: {
      truePositive: { mean: mean(tps), stddev: stddev(tps) },
      falseNegative: { mean: mean(fns), stddev: stddev(fns) },
      falsePositive: { mean: mean(fps), stddev: stddev(fps) },
      trueNegative: { mean: mean(tns), stddev: stddev(tns) },
      recall: { mean: mean(recalls), stddev: stddev(recalls) },
    },
    llmCost,
    rawTrials: trials,
  };
}

/**
 * Collects the "interesting" false-positives from a branch's trials: the
 * non-DOM props the pipeline excluded that pre-classify did NOT pre-emptively
 * exclude. These are over-exclusions the LLM made on its own, and the most
 * useful signal for prompt refinement.
 *
 * Output is shaped for direct consumption by a self-heal agent: per prop name,
 * frequency across all trials and per-component examples.
 */
function collectInterestingFps(branchSummary: TrialBranchSummary): {
  branch: string;
  trials: number;
  totalInteresting: number;
  byProp: Array<{
    prop: string;
    occurrences: number;
    examples: Array<{ component: string; type: string; repo: string; trial: number }>;
  }>;
} {
  type Example = { component: string; type: string; repo: string; trial: number };
  const byProp = new Map<string, Example[]>();

  for (let i = 0; i < branchSummary.rawTrials.length; i++) {
    const trial = branchSummary.rawTrials[i];
    for (const r of trial.results) {
      const fps = r.devPropLeakage?.falsePositives ?? [];
      for (const fp of fps) {
        if (fp.preClassifyExcluded) continue;
        if (!byProp.has(fp.prop)) byProp.set(fp.prop, []);
        byProp.get(fp.prop)!.push({
          component: fp.component,
          type: fp.type,
          repo: r.repo,
          trial: i + 1,
        });
      }
    }
  }

  const sorted = [...byProp.entries()]
    .map(([prop, examples]) => ({
      prop,
      occurrences: examples.length,
      examples: examples.slice(0, 10),
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  return {
    branch: branchSummary.branch,
    trials: branchSummary.trials,
    totalInteresting: sorted.reduce((s, e) => s + e.occurrences, 0),
    byProp: sorted,
  };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

async function main() {
  const { values } = parseArgs({
    options: {
      control: { type: 'string', default: 'main' },
      candidate: { type: 'string' },
      trials: { type: 'string', default: '3' },
      repo: { type: 'string' },
      'keep-worktrees': { type: 'boolean', default: false },
    },
  });

  if (!values.candidate) {
    console.error('Missing required --candidate <branch>');
    process.exit(1);
  }

  const trialsN = Number.parseInt(values.trials!, 10);
  if (!Number.isInteger(trialsN) || trialsN < 1) {
    console.error(`--trials must be a positive integer, got: ${values.trials}`);
    process.exit(1);
  }

  const branches = [values.control!, values.candidate!];
  console.log(`Running ${trialsN} trial(s) per branch: ${branches.join(' vs ')}`);
  if (values.repo) console.log(`Scoped to repo: ${values.repo}`);

  const branchSummaries: TrialBranchSummary[] = [];

  for (const branch of branches) {
    const wt = ensureWorktree(branch);
    installAndBuild(wt);

    const trials: TrialRunResult[] = [];
    for (let i = 0; i < trialsN; i++) {
      trials.push(runTrial(branch, wt, i, values.repo));
    }
    branchSummaries.push(summarizeBranch(branch, trials));
  }

  const reportPath = resolve(EVAL_DIR, `trial-report-${Date.now()}.md`);
  const report = buildTrialReport({
    control: branchSummaries[0],
    candidate: branchSummaries[1],
    repoFilter: values.repo,
  });
  await writeFile(reportPath, report);
  console.log(`\nTrial report written to: ${reportPath}`);

  // Sidecar JSON: every interesting FP (LLM dropped the prop on its own,
  // pre-classify did not request exclusion) for the candidate branch, ready
  // to feed into a self-heal prompt-refinement loop.
  const fpPath = reportPath.replace(/\.md$/, '-false-positives.json');
  const candidateFps = collectInterestingFps(branchSummaries[1]);
  await writeFile(fpPath, JSON.stringify(candidateFps, null, 2));
  console.log(`Candidate false-positives written to: ${fpPath}`);

  if (!values['keep-worktrees']) {
    console.log('Cleaning up worktrees…');
    for (const branch of branches) {
      const slug = branch.replace(/[/]/g, '__');
      const path = resolve(WORKTREES_DIR, slug);
      try {
        sh('git', ['worktree', 'remove', '--force', path], REPO_ROOT);
      } catch (err) {
        console.warn(`failed to remove worktree ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    rmSync(resolve(WORKTREES_DIR, 'results'), { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Trial harness failed:', err);
  process.exit(1);
});
