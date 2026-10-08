import { generateUlid } from '../helpers/generate-ulid.js';
import { readRunsFileMaybe } from '../repositories/read-runs-file.js';
import { writeRunsFileAtomic } from '../repositories/write-runs-file.js';
import type { AppendInput, RunRecord } from '../types/run-record.js';
import { RUNS_FILE_VERSION } from '../types/run-record.js';

const RUNS_FILE_CAP = 200;

export async function appendRun(input: AppendInput): Promise<RunRecord> {
  const existing = await readRunsFileMaybe();
  const record: RunRecord = {
    ...input,
    id: input.id ?? generateUlid(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    sourceFingerprint: input.sourceFingerprint ?? null,
  };
  const runs = existing ? [record, ...existing.runs] : [record];
  if (runs.length > RUNS_FILE_CAP) {
    const dropped = runs.length - RUNS_FILE_CAP;
    runs.length = RUNS_FILE_CAP;
    console.warn(
      `runs.json reached cap of ${RUNS_FILE_CAP}; dropped ${dropped} oldest entr${dropped === 1 ? 'y' : 'ies'}.`,
    );
  }
  await writeRunsFileAtomic({ version: RUNS_FILE_VERSION, runs });
  return record;
}
