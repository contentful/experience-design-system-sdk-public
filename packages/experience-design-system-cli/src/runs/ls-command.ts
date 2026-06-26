import type { Command } from 'commander';
import { listRuns, type RunRecord } from './store.js';
import { resolveRunTarget } from './resolve-run-target.js';

export type RunLsOptions = {
  write?: (chunk: string) => void;
  projectPath?: string;
  limit?: number;
  target?: string;
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

function renderDetail(run: RunRecord, write: (s: string) => void): void {
  const lines = [
    `Run ${run.id}`,
    `Created: ${formatCreated(run.createdAt)}`,
    `Project: ${run.projectPath}`,
    `Saved:   ${run.savePath}`,
    `Components: ${run.componentCount}`,
    `Tokens:     ${run.tokenCount}`,
    `Agent:      ${run.agent}`,
    `Pushed:     ${formatPushed(run)}`,
    '',
    `Push to Contentful:   experiences import --push-from-run ${run.id}`,
    `Modify in wizard:     experiences import --modify ${run.id}`,
    '',
  ];
  write(lines.join('\n'));
}

export async function runLsCommand(opts: RunLsOptions = {}): Promise<void> {
  const write = opts.write ?? ((s: string) => process.stdout.write(s));

  if (opts.target) {
    const run = await resolveRunTarget(opts.target);
    renderDetail(run, write);
    return;
  }

  const runs = await listRuns({
    ...(opts.projectPath ? { projectPath: opts.projectPath } : {}),
    ...(typeof opts.limit === 'number' ? { limit: opts.limit } : {}),
  });
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
    .action(
      async (
        target: string | undefined,
        options: { project?: string; limit?: number },
      ) => {
        await runLsCommand({
          ...(target ? { target } : {}),
          ...(options.project ? { projectPath: options.project } : {}),
          ...(typeof options.limit === 'number' && !Number.isNaN(options.limit)
            ? { limit: options.limit }
            : {}),
        });
      },
    );
}
