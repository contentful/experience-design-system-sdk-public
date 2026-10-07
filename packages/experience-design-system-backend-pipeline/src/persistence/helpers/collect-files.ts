import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CandidateFile } from '../../steps/shared/types/index.js';
import { EXCLUDED_SUFFIXES, IGNORED_DIRS, INCLUDED_EXTENSIONS } from '../constants.js';

function isIncluded(filePath: string): boolean {
  if (EXCLUDED_SUFFIXES.some((suffix) => filePath.endsWith(suffix))) return false;
  return INCLUDED_EXTENSIONS.has(path.extname(filePath));
}

function walkDir(dir: string, results: CandidateFile[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        walkDir(path.join(dir, entry.name), results);
      }
    } else if (entry.isFile()) {
      const filePath = path.join(dir, entry.name);
      if (isIncluded(entry.name)) {
        const content = readFileSync(filePath, 'utf8');
        results.push({ path: filePath, content });
      }
    }
  }
}

export function collectFiles(root: string): CandidateFile[] {
  const stat = statSync(root);
  if (!stat.isDirectory()) {
    throw new Error(`collectFiles: expected a directory, got: ${root}`);
  }
  const results: CandidateFile[] = [];
  walkDir(root, results);
  return results;
}
