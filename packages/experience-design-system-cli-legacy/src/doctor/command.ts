import type { Command } from 'commander';
import { findPkgRoot } from '../lib/cli-path.js';
import { c } from '../output/format.js';
import { reportAgent, reportBuild, reportDependencies, reportNode, reportPnpm } from './checks.js';
import { fail, ok, section, warn } from './report.js';

interface CheckOutcome {
  name: string;
  ok: boolean;
  required: boolean;
}

/** Run the checks in order, stopping a chain as soon as a later check can no longer pass. */
async function runChecks(): Promise<CheckOutcome[]> {
  const pkgRoot = findPkgRoot();
  const results: CheckOutcome[] = [];
  const record = (name: string, passed: boolean, required = true): boolean => {
    results.push({ name, ok: passed, required });
    return passed;
  };

  // Every later check needs a working Node, and install needs pnpm, so a failure stops the chain.
  if (record('Node.js version', await reportNode())) {
    const pnpmOk = record('pnpm', await reportPnpm(pkgRoot));
    if (pnpmOk && record('dependencies', await reportDependencies(pkgRoot))) {
      record('build', await reportBuild(pkgRoot));
    }
  }

  record('coding agent', await reportAgent(), false);

  return results;
}

function printSummary(results: CheckOutcome[]): number {
  section('Summary');
  for (const r of results) {
    if (r.ok) ok(r.name);
    else if (r.required) fail(`${r.name} — required`);
    else warn(`${r.name} — optional`);
  }

  const failed = results.filter((r) => !r.ok);
  const requiredFailed = failed.filter((r) => r.required).length;

  if (failed.length === 0) {
    process.stderr.write(`\n${c.green(c.bold('✓ All checks passed. You are ready to run: experiences import'))}\n\n`);
    return 0;
  }
  if (requiredFailed === 0) {
    process.stderr.write(`\n${c.yellow(c.bold('⚠ Required checks passed, but optional checks failed.'))}\n`);
    process.stderr.write(
      `  You can run ${c.bold('experiences import')} but the generate steps may fail without a coding agent.\n\n`,
    );
    return 0;
  }
  process.stderr.write(
    `\n${c.red(c.bold(`✗ ${requiredFailed} required check${requiredFailed === 1 ? '' : 's'} failed.`))}\n`,
  );
  process.stderr.write(`  Fix the issues above, then re-run ${c.bold('experiences doctor')}.\n\n`);
  return 1;
}

async function runDoctor(): Promise<void> {
  process.stderr.write(`${c.bold('experiences doctor')} — checking your environment\n`);
  process.exitCode = printSummary(await runChecks());
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check prerequisites so experiences import runs without errors')
    .helpOption(false)
    .action(() => runDoctor());
}
