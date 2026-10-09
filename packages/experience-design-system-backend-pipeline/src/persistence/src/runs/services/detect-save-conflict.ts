import { listConflictingFiles } from '../repositories/list-conflicting-files.js';

export async function detectSaveConflict(path: string): Promise<boolean> {
  return (await listConflictingFiles(path)).length > 0;
}
