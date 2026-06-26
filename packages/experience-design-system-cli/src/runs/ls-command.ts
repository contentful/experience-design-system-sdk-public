import type { Command } from 'commander';
import { listRuns, type RunRecord } from './store.js';

export type RunLsOptions = {
  write?: (chunk: string) => void;
  projectPath?: string;
  limit?: number;
};

function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
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

const COLUMNS: { header: string; width: number; get: (r: RunRecord) => string }[] = [
  { header: 'ID', width: 28, get: (r) => r.id },
  { header: 'CREATED', width: 18, get: (r) => formatCreated(r.createdAt) },
  { header: 'PROJECT', width: 32, get: (r) => r.projectPath },
  { header: 'SAVED TO', width: 32, get: (r) => r.savePath },
  { header: 'COMPONENTS', width: 11, get: (r) => String(r.componentCount) },
  { header: 'PUSHED', width: 30, get: formatPushed },
];

export async function runLsCommand(opts: RunLsOptions = {}): Promise<void> {
  const write = opts.write ?? ((s: string) => process.stdout.write(s));
  const runs = await listRuns({
    ...(opts.projectPath ? { projectPath: opts.projectPath } : {}),
    ...(typeof opts.limit === 'number' ? { limit: opts.limit } : {}),
  });
  if (runs.length === 0) {
    write('No runs recorded yet. Run `experiences import` to create one.\n');
    return;
  }
  const headerRow = COLUMNS.map((c) => pad(c.header, c.width)).join('  ');
  write(headerRow + '\n');
  for (const r of runs) {
    const row = COLUMNS.map((c) => pad(c.get(r), c.width)).join('  ');
    write(row + '\n');
  }
}

export function registerRunsCommand(program: Command): void {
  program
    .command('runs')
    .alias('ls')
    .description('List recorded import runs from ~/.config/experiences/runs.json')
    .option('--project <path>', 'Filter by source project path (absolute)')
    .option('--limit <n>', 'Limit the number of rows', (v) => parseInt(v, 10))
    .action(async (options: { project?: string; limit?: number }) => {
      await runLsCommand({
        ...(options.project ? { projectPath: options.project } : {}),
        ...(typeof options.limit === 'number' && !Number.isNaN(options.limit) ? { limit: options.limit } : {}),
      });
    });
}
