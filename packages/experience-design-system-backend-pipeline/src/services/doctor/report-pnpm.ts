import { checkPnpm } from './check-pnpm.js';
import type { CheckOutcome, ReportLine } from './types/report.js';

export async function reportPnpm(pkgRoot: string): Promise<CheckOutcome> {
  const lines: ReportLine[] = [{ kind: 'section', text: 'Checking pnpm' }];
  const check = await checkPnpm(pkgRoot);
  if (check.status === 'missing') {
    lines.push({ kind: 'fail', text: 'pnpm not found' });
    lines.push({ kind: 'info', text: 'How to fix:' });
    lines.push({ kind: 'info', text: '  npm install -g pnpm' });
    lines.push({ kind: 'info', text: '  # or: corepack enable pnpm' });
    return { name: 'pnpm', ok: false, required: true, lines };
  }
  if (check.status === 'broken') {
    lines.push({ kind: 'fail', text: 'pnpm found but not working' });
    lines.push({ kind: 'info', text: 'Try reinstalling: npm install -g pnpm --force' });
    return { name: 'pnpm', ok: false, required: true, lines };
  }

  lines.push({ kind: 'ok', text: `pnpm v${check.version}` });

  if (check.status === 'unusable-in-repo') {
    lines.push({ kind: 'fail', text: 'pnpm cannot execute in repo root' });
    lines.push({ kind: 'info', text: 'The pnpm global store may be mismatched with your current Node version.' });
    lines.push({ kind: 'info', text: 'How to fix:' });
    lines.push({ kind: 'info', text: '  npm install -g pnpm --force' });
    return { name: 'pnpm', ok: false, required: true, lines };
  }

  return { name: 'pnpm', ok: true, required: true, lines };
}
