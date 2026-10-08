import { homedir } from 'node:os';
import { checkNodeVersion } from '../helpers/check-node-version.js';
import { detectNodeVersionManagers } from '../services/detect-node-version-managers.js';
import type { CheckOutcome, ReportLine } from '../types/report.js';

export async function reportNode(): Promise<CheckOutcome> {
  const lines: ReportLine[] = [{ kind: 'section', text: 'Checking Node.js version' }];
  const check = checkNodeVersion();
  if (check.passed) {
    lines.push({ kind: 'ok', text: `Node.js v${check.version}` });
    return { name: 'Node.js version', ok: true, required: true, lines };
  }

  lines.push({ kind: 'fail', text: `Node.js v${check.version} — need v${check.required}+` });
  lines.push({ kind: 'info', text: '' });
  lines.push({ kind: 'info', text: 'How to fix:' });
  const managers = await detectNodeVersionManagers(homedir());
  if (managers.nvm) {
    lines.push({ kind: 'info', text: `  nvm install ${check.required}` });
    lines.push({ kind: 'info', text: `  nvm use ${check.required}` });
    lines.push({ kind: 'info', text: `  nvm alias default ${check.required}   # make it permanent` });
  } else if (managers.fnm) {
    lines.push({ kind: 'info', text: `  fnm install ${check.required}` });
    lines.push({ kind: 'info', text: `  fnm use ${check.required}` });
  } else {
    lines.push({ kind: 'info', text: `  Download Node v${check.required} from https://nodejs.org` });
  }
  return { name: 'Node.js version', ok: false, required: true, lines };
}
