import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { SAVE_FILES } from './save-files.js';

export async function listConflictingFiles(path: string): Promise<string[]> {
  const conflicts: string[] = [];
  for (const name of SAVE_FILES) {
    try {
      await access(join(path, name));
      conflicts.push(name);
    } catch {
      // not present
    }
  }
  return conflicts;
}
