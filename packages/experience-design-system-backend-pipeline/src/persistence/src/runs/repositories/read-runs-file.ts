import { readFile } from 'node:fs/promises';
import { runsFilePath } from '../../session/helpers/config-root.js';
import { migrateRecord } from '../core/migrate-record.js';
import {
  READABLE_VERSIONS,
  RUNS_FILE_VERSION,
  type RunsFile,
  type RunsFileV1,
  type RunsFileV2,
} from '../types/run-record.js';

export async function readRunsFileMaybe(): Promise<RunsFile | null> {
  try {
    const raw = await readFile(runsFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as RunsFile | RunsFileV1 | RunsFileV2;
    if (!READABLE_VERSIONS.has(parsed.version)) {
      throw new Error(
        `runs.json version mismatch: file is v${parsed.version}, this CLI expects v${RUNS_FILE_VERSION} (also reads: ${[...READABLE_VERSIONS].join(', ')}). Back up and remove the file to start fresh.`,
      );
    }
    const runs = parsed.runs.map(migrateRecord);
    return { version: RUNS_FILE_VERSION, runs };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw err;
  }
}
