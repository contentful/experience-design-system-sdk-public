import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runsFilePath } from '../../session/config-root.js';
import type { RunsFile } from '../types/run-record.js';

export async function writeRunsFileAtomic(file: RunsFile): Promise<void> {
  await mkdir(dirname(runsFilePath()), { recursive: true });
  const body = JSON.stringify(file, null, 2) + '\n';
  const tmp = `${runsFilePath()}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, runsFilePath());
}
