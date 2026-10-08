import { runsFilePath } from '../session/config-root.js';
import { readRunsFileMaybe } from './helpers/read-runs-file.js';
import { writeRunsFileAtomic } from './helpers/write-runs-file.js';
import type { RunRecord } from './types/run-record.js';
import { RUNS_FILE_VERSION } from './types/run-record.js';

export async function updateRun(id: string, patch: Partial<Omit<RunRecord, 'id'>>): Promise<RunRecord> {
  const file = (await readRunsFileMaybe()) ?? { version: RUNS_FILE_VERSION, runs: [] };
  const idx = file.runs.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error(`Run ${id} not found in ${runsFilePath()}`);
  const updated: RunRecord = { ...file.runs[idx]!, ...patch, id };
  file.runs[idx] = updated;
  await writeRunsFileAtomic(file);
  return updated;
}
