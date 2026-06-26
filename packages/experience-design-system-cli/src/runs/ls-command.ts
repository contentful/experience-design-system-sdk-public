import type { Command } from 'commander';
import { listRuns, type RunRecord } from './store.js';
import { resolveRunTarget } from './resolve-run-target.js';

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

const COLUMNS: { header: string; get: (r: RunRecord) => string }[] = [
  { header: 'ID', get: (r) => r.id },
  { header: 'CREATED', get: (r) => formatCreated(r.createdAt) },
  { header: 'PROJECT', get: (r) => r.projectPath },
  { header: 'SAVED TO', get: (r) => r.savePath },
  { header: 'COMPONENTS', get: (r) => String(r.componentCount) },
  { header: 'PUSHED', get: formatPushed },
];

function renderFooter(runs: RunRecord[], write: (s: string) => void): void {
  if (runs.length === 0) return;
  const id = runs[0]!.id;
  write('\n');
  write(`Push run ${id}:    experiences import --push-from-run ${id}\n`);
  write(`Modify run ${id}:  experiences import --modify ${id}\n`);
}

function renderDetail(run: RunRecord, write: (s: string) => void): void {
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
  lines.push(
    `Agent:      ${run.agent}`,
    `Pushed:     ${formatPushed(run)}`,
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
    renderDetail(run, write);
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
  // Auto-expand each column to max(header, max(row value)) so long paths
  // aren't silently truncated.
  const widths = COLUMNS.map((c) =>
    Math.max(c.header.length, ...runs.map((r) => c.get(r).length)),
  );
  const headerRow = COLUMNS.map((c, i) => pad(c.header, widths[i]!)).join('  ');
  write(headerRow + '\n');
  for (const r of runs) {
    const row = COLUMNS.map((c, i) => pad(c.get(r), widths[i]!)).join('  ');
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
          ...(typeof options.limit === 'number' && !Number.isNaN(options.limit)
            ? { limit: options.limit }
            : {}),
          ...(options.json ? { json: true } : {}),
          ...(options.pushed ? { pushed: true } : {}),
          ...(options.notPushed ? { notPushed: true } : {}),
        });
      },
    );
}
