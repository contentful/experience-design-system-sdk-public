import { statSync } from 'node:fs';
import { resolveUserPath } from '../../../import/resolve-user-path.js';
import { cleanPathText } from '../../../shared/path-text.js';

function isExistingFile(path: string): boolean {
  try {
    return !statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function baseDirProblem(baseDir: string): string | null {
  if (cleanPathText(baseDir) === '') return null;
  const path = resolveUserPath(baseDir);
  if (!isExistingFile(path)) return null;
  return `The Root Project Directory must be a folder, but ${path} is a file. Use the folder that contains it.`;
}

export function usableBaseDir(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const baseDir = cleanPathText(value);
  return baseDir !== '' && baseDirProblem(baseDir) === null ? baseDir : undefined;
}
