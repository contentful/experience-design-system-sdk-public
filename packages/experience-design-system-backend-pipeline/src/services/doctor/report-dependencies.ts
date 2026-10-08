import { join } from 'node:path';
import { pathExists } from './helpers/path-exists.js';
import { stderrLines } from './helpers/stderr-lines.js';
import { installDependencies } from './install-dependencies.js';
import type { CheckOutcome, ReportLine } from './types/report.js';

export async function reportDependencies(pkgRoot: string): Promise<CheckOutcome> {
  const lines: ReportLine[] = [{ kind: 'section', text: 'Checking dependencies (pnpm install)' }];

  if (!(await pathExists(join(pkgRoot, 'node_modules')))) {
    lines.push({ kind: 'info', text: 'node_modules not found — running pnpm install...' });
  } else {
    lines.push({ kind: 'info', text: 'Running pnpm install to ensure dependencies are up to date...' });
  }

  const check = await installDependencies(join(pkgRoot, '..', '..'));
  if (!check.passed) {
    lines.push({ kind: 'fail', text: 'pnpm install failed' });
    lines.push({ kind: 'info', text: '' });
    lines.push(...stderrLines(check.result.stderr, 10));
    lines.push({ kind: 'info', text: '' });
    lines.push({ kind: 'info', text: 'How to fix:' });
    lines.push({ kind: 'info', text: '  • Try: pnpm install (without --frozen-lockfile) to update the lockfile' });
    lines.push({ kind: 'info', text: '  • Check that your Node version matches: cat .nvmrc' });
    return { name: 'dependencies', ok: false, required: true, lines };
  }

  lines.push({ kind: 'ok', text: 'Dependencies installed' });
  return { name: 'dependencies', ok: true, required: true, lines };
}
