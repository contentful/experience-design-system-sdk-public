import { readRunsFileMaybe } from './helpers/read-runs-file.js';
import type { ListOptions, RunRecord } from './types/run-record.js';

export async function listRuns(opts: ListOptions = {}): Promise<RunRecord[]> {
  const file = await readRunsFileMaybe();
  if (!file) return [];
  let runs = file.runs;
  if (opts.projectPath) runs = runs.filter((r) => r.projectPath === opts.projectPath);
  if (opts.before) runs = runs.filter((r) => r.createdAt < opts.before!);
  if (opts.after) runs = runs.filter((r) => r.createdAt > opts.after!);
  if (typeof opts.limit === 'number') runs = runs.slice(0, opts.limit);
  return runs;
}
