import { runsFilePath } from '../../session/helpers/config-root.js';
import { readRunsFileMaybe } from '../repositories/read-runs-file.js';
import type { RunRecord } from '../types/run-record.js';

export async function getRun(id: string): Promise<RunRecord> {
  const file = await readRunsFileMaybe();
  const found = file?.runs.find((r) => r.id === id);
  if (!found) throw new Error(`Run ${id} not found in ${runsFilePath()}`);
  return found;
}
