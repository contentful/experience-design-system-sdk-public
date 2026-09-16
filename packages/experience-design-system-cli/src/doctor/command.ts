import type { Command } from 'commander';
import { findPkgRoot } from '../lib/cli-path.js';
import { reportAgent, reportBuild, reportDependencies, reportNode, reportPnpm } from './checks.js';
import { fail, info, ok, section, warn } from './report.js';

export interface DoctorOptions {
  skipBuild?: boolean;
  skipAgent?: boolean;
}

interface CheckOutcome {
  name: string;
  ok: boolean;
  required: boolean;
}

export async function runDoctor(opts: DoctorOptions): Promise<void> {
  process.stderr.write('\x1b[1mexperiences doctor\x1b[0m — checking your environment\n');

  const pkgRoot = findPkgRoot();
  const results: CheckOutcome[] = [];

  const nodeOk = await reportNode();
  results.push({ name: 'Node.js version', ok: nodeOk, required: true });

  // Every later check needs a working Node, so a failure here stops the chain.
  if (nodeOk) {
    const pnpmOk = await reportPnpm(pkgRoot);
    results.push({ name: 'pnpm', ok: pnpmOk, required: true });

    if (!opts.skipBuild) {
      if (pnpmOk) {
        const depsOk = await reportDependencies(pkgRoot);
        results.push({ name: 'dependencies', ok: depsOk, required: true });

        if (depsOk) {
          const buildOk = await reportBuild(pkgRoot);
          results.push({ name: 'build', ok: buildOk, required: true });
        }
      }
    } else {
      info('\nSkipping install + build (--skip-build)');
    }
  }

  if (!opts.skipAgent) {
    const agentOk = await reportAgent();
    results.push({ name: 'coding agent', ok: agentOk, required: false });
  }

  section('Summary');
  const failed = results.filter((r) => !r.ok);
  const requiredFailed = failed.filter((r) => r.required);

  for (const r of results) {
    if (r.ok) ok(r.name);
    else if (r.required) fail(`${r.name} — required`);
    else warn(`${r.name} — optional`);
  }

  if (requiredFailed.length === 0 && failed.length === 0) {
    process.stderr.write('\n\x1b[32m\x1b[1m✓ All checks passed. You are ready to run: experiences import\x1b[0m\n\n');
    process.exit(0);
  } else if (requiredFailed.length === 0) {
    process.stderr.write('\n\x1b[33m\x1b[1m⚠ Required checks passed, but optional checks failed.\x1b[0m\n');
    process.stderr.write(
      '  You can run \x1b[1mexperiences import\x1b[0m but the generate steps may fail without a coding agent.\n\n',
    );
    process.exit(0);
  } else {
    process.stderr.write(
      `\n\x1b[31m\x1b[1m✗ ${requiredFailed.length} required check${requiredFailed.length === 1 ? '' : 's'} failed.\x1b[0m\n`,
    );
    process.stderr.write('  Fix the issues above, then re-run \x1b[1mexperiences doctor\x1b[0m.\n\n');
    process.exit(1);
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check prerequisites so experiences import runs without errors')
    .option('--skip-build', 'Skip the pnpm install + build step (useful if already built)')
    .option('--skip-agent', 'Skip the coding agent check')
    .action((opts: DoctorOptions) => runDoctor(opts));
}
