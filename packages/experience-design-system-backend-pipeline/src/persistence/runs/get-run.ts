import { runsFilePath } from '../session/config-root.js';
import { readRunsFileMaybe } from './helpers/read-runs-file.js';
import type { RunRecord } from './types/run-record.js';

export async function getRun(id: string): Promise<RunRecord> {
  const file = await readRunsFileMaybe();
  const found = file?.runs.find((r) => r.id === id);
  if (!found) throw new Error(`Run ${id} not found in ${runsFilePath()}`);
  return found;
}
