import type { Command } from 'commander';
import { listRuns, type RunRecord } from './store.js';
import { resolveRunTarget } from './resolve-run-target.js';
import { checkRunStaleness, shortStalenessSummary, formatStalenessDetail, type Staleness } from './staleness.js';

export type RunLsOptions = {
  write?: (chunk: string) => void;
  projectPath?: string;
  limit?: number;
  target?: string;
  json?: boolean;
  pushed?: boolean;
  notPushed?: boolean;
};

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}

function formatCreated(iso: string): string {
  // Drop ms + Z, render as `YYYY-MM-DD HH:MM`.
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

function formatPushed(record: RunRecord): string {
  if (!record.pushedTo) return '(not pushed)';
  return `${record.pushedTo.spaceId}/${record.pushedTo.environmentId}`;
}

type Column = { header: string; get: (r: RunRecord, idx: number) => string };

function makeColumns(staleness: Staleness[]): Column[] {
  return [
    { header: 'ID', get: (r) => r.id },
    { header: 'CREATED', get: (r) => formatCreated(r.createdAt) },
    { header: 'PROJECT', get: (r) => r.projectPath },
    { header: 'SAVED TO', get: (r) => r.savePath },
    { header: 'COMPONENTS', get: (r) => String(r.componentCount) },
    { header: 'PUSHED', get: formatPushed },
    { header: 'STALE', get: (_r, i) => shortStalenessSummary(staleness[i]!) },
  ];
}

function renderFooter(runs: RunRecord[], write: (s: string) => void): void {
  if (runs.length === 0) return;
  const id = runs[0]!.id;
  write('\n');
  write(`Push run ${id}:    experiences import --push-from-run ${id}\n`);
  write(`Modify run ${id}:  experiences import --modify ${id}\n`);
}

async function renderDetail(run: RunRecord, write: (s: string) => void): Promise<void> {
  const lines = [
    `Run ${run.id}`,
    `Created: ${formatCreated(run.createdAt)}`,
    `Project: ${run.projectPath}`,
    `Saved:   ${run.savePath}`,
    `Components: ${run.componentCount}`,
    `Tokens:     ${run.tokenCount}`,
  ];
  if (run.tokensPath) {
    lines.push(`Tokens saved: ${run.tokensPath}`);
  }
  lines.push(`Agent:      ${run.agent}`, `Pushed:     ${formatPushed(run)}`, '');
  // Staleness status block. v2/v1 records (no sourceFingerprint) render as
  // UNKNOWN — the operator can re-extract for a fresh run.
  if (!run.sourceFingerprint) {
    lines.push('Status: UNKNOWN (run pre-dates the staleness fingerprint).');
  } else {
    const staleness = await checkRunStaleness(run);
    lines.push(...formatStalenessDetail(staleness));
  }
  lines.push(
    '',
    `Push to Contentful:   experiences import --push-from-run ${run.id}`,
    `Modify in wizard:     experiences import --modify ${run.id}`,
    '',
  );
  write(lines.join('\n'));
}

export async function runLsCommand(opts: RunLsOptions = {}): Promise<void> {
  const write = opts.write ?? ((s: string) => process.stdout.write(s));

  if (opts.pushed && opts.notPushed) {
    throw new Error('--pushed and --not-pushed are mutually exclusive');
  }

  if (opts.target) {
    const run = await resolveRunTarget(opts.target);
    if (opts.json) {
      write(JSON.stringify(run, null, 2) + '\n');
      return;
    }
    await renderDetail(run, write);
    return;
  }

  let runs = await listRuns({
    ...(opts.projectPath ? { projectPath: opts.projectPath } : {}),
    ...(typeof opts.limit === 'number' ? { limit: opts.limit } : {}),
  });

  if (opts.pushed) runs = runs.filter((r) => r.pushedTo !== null);
  if (opts.notPushed) runs = runs.filter((r) => r.pushedTo === null);

  if (opts.json) {
    write(JSON.stringify(runs, null, 2) + '\n');
    return;
  }

  if (runs.length === 0) {
    write('No runs recorded yet. Run `experiences import` to create one.\n');
    return;
  }
  // Compute staleness once per row so the table is consistent across the
  // STALE column and any future detail-equivalent surfaces.
  const stalenessByIdx = await Promise.all(runs.map(async (r) => (r.sourceFingerprint ? checkRunStaleness(r) : null)));
  const stalenessForCol: Staleness[] = stalenessByIdx.map(
    (s) =>
      s ?? {
        stale: false,
        staleComponents: [],
        staleTokens: false,
        savedComponentsEdited: false,
        savedTokensEdited: false,
        missingSourceFiles: [],
      },
  );
  const columns = makeColumns(stalenessForCol);
  // Auto-expand each column to max(header, max(row value)) so long paths
  // aren't silently truncated.
  const widths = columns.map((c) => Math.max(c.header.length, ...runs.map((r, i) => c.get(r, i).length)));
  const headerRow = columns.map((c, i) => pad(c.header, widths[i]!)).join('  ');
  write(headerRow + '\n');
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!;
    const row = columns.map((c, ci) => pad(c.get(r, i), widths[ci]!)).join('  ');
    write(row + '\n');
  }
  renderFooter(runs, write);
}

export function registerRunsCommand(program: Command): void {
  program
    .command('runs [target]')
    .alias('ls')
    .description(
      'List recorded import runs from ~/.config/experiences/runs.json, or show one run when [target] (id or path) is given',
    )
    .option('--project <path>', 'Filter by source project path (absolute)')
    .option('--limit <n>', 'Limit the number of rows', (v) => parseInt(v, 10))
    .option('--json', 'Emit RunRecord JSON to stdout (array, or single object with [target])')
    .option('--pushed', 'Only show runs that have been pushed to Contentful')
    .option('--not-pushed', 'Only show runs that have not been pushed')
    .action(
      async (
        target: string | undefined,
        options: {
          project?: string;
          limit?: number;
          json?: boolean;
          pushed?: boolean;
          notPushed?: boolean;
        },
      ) => {
        await runLsCommand({
          ...(target ? { target } : {}),
          ...(options.project ? { projectPath: options.project } : {}),
          ...(typeof options.limit === 'number' && !Number.isNaN(options.limit) ? { limit: options.limit } : {}),
          ...(options.json ? { json: true } : {}),
          ...(options.pushed ? { pushed: true } : {}),
          ...(options.notPushed ? { notPushed: true } : {}),
        });
      },
    );
}
