import { join } from 'node:path';
import { buildCli } from './build-cli.js';
import { stderrLines } from './helpers/stderr-lines.js';
import type { CheckOutcome, ReportLine } from './types/report.js';

export async function reportBuild(pkgRoot: string): Promise<CheckOutcome> {
  const lines: ReportLine[] = [{ kind: 'section', text: 'Building CLI' }];
  lines.push({ kind: 'info', text: 'Running pnpm build...' });

  const check = await buildCli(join(pkgRoot, '..', '..'));
  if (!check.passed) {
    lines.push({ kind: 'fail', text: 'Build failed' });
    lines.push({ kind: 'info', text: '' });
    lines.push(...stderrLines(check.result.stderr, 15));
    lines.push({ kind: 'info', text: '' });
    lines.push({ kind: 'info', text: 'How to fix:' });
    lines.push({ kind: 'info', text: '  • Check for TypeScript errors: pnpm typecheck' });
    lines.push({
      kind: 'info',
      text: '  • If the error is in a generated file under dist/, try: pnpm clean && pnpm build',
    });
    return { name: 'build', ok: false, required: true, lines };
  }

  lines.push({ kind: 'ok', text: 'Build succeeded' });
  return { name: 'build', ok: true, required: true, lines };
}
