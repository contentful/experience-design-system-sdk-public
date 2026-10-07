import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CandidateFile } from '../shared/types.js';

const INCLUDED_EXTENSIONS = new Set(['.astro', '.js', '.jsx', '.svelte', '.ts', '.tsx', '.vue']);
const EXCLUDED_SUFFIXES = [
  '.d.ts',
  '.stories.ts',
  '.stories.tsx',
  '.stories.js',
  '.stories.jsx',
  '.test.ts',
  '.test.tsx',
  '.test.js',
  '.test.jsx',
  '.spec.ts',
  '.spec.tsx',
  '.spec.js',
  '.spec.jsx',
];
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'build', 'coverage', '.next', '.vscode', '.nx']);

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
