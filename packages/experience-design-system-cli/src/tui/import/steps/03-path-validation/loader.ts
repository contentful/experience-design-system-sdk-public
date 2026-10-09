import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  IGNORED_DIRECTORIES,
  addFile,
  emptyCounts,
  failureFromErrorCode,
  mergeCounts,
  type FileCounts,
  type ScanResult,
} from './logic.js';

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function countEntry(directory: string, entry: Dirent): Promise<FileCounts> {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return countFiles(path);
  if (entry.isFile() || (entry.isSymbolicLink() && (await isFile(path)))) return addFile(emptyCounts(), entry.name);
  return emptyCounts();
}

async function countFiles(directory: string): Promise<FileCounts> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return emptyCounts();
  }
  const counts = await Promise.all(
    entries.filter((entry) => !IGNORED_DIRECTORIES.has(entry.name)).map((entry) => countEntry(directory, entry)),
  );
  return counts.reduce(mergeCounts, emptyCounts());
}

export async function scanProject(directory: string): Promise<ScanResult> {
  try {
    const stats = await stat(directory);
    if (stats.isFile()) return { ok: false, failure: 'is-file' };
    if (!stats.isDirectory()) return { ok: false, failure: 'not-directory' };
  } catch (error) {
    return { ok: false, failure: failureFromErrorCode((error as NodeJS.ErrnoException).code) };
  }
  return { ok: true, counts: await countFiles(directory) };
}
