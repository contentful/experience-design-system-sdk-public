import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import path from 'node:path';
import type { CandidateFile } from '../../../steps/shared/index.js';
import {
  DENYLIST_GATED_EXTENSIONS,
  EXCLUDED_SUFFIXES,
  IGNORED_DIRS,
  INCLUDED_EXTENSIONS,
  isDenylistedNoiseFile,
} from '../constants/file-patterns.js';

/** Per-category file counts for display. Matches path-validation's shape. */
export interface FileCounts {
  tsx: number;
  ts: number;
  vue: number;
  astro: number;
  svelte: number;
  jsx: number;
  js: number;
  json: number;
  md: number;
  other: number;
  total: number;
}

/** Reason a `collectFiles` call could not produce a result. */
export type CollectFilesFailure = 'not-found' | 'permission-denied' | 'is-file' | 'not-directory' | 'unreadable';

/**
 * What path-validation needs to render + what extract needs to consume.
 * One walk, two downstream consumers.
 */
export interface CollectFilesResult {
  /** Absolute paths of files that pass the walk filters — fed to `extractComponents`. */
  filePaths: string[];
  /** Per-category counts for the UI summary. Sums to `total`. */
  counts: FileCounts;
  /** Advisory messages ("no source files found", "mostly .json") for the UI. */
  warnings: string[];
  /** Absolute, resolved walk root — the caller can echo this back to the user. */
  rootPath: string;
  /**
   * Full `{ path, content }` records when `includeContent: true` was passed.
   * Legacy extraction consumed `CandidateFile[]`; new extractors read via
   * ts-morph so default is content-less and this stays undefined.
   */
  candidateFiles?: CandidateFile[];
}

export type CollectFilesOutcome =
  | { ok: true; result: CollectFilesResult }
  | { ok: false; failure: CollectFilesFailure; rootPath: string };

export interface CollectFilesOptions {
  /**
   * When true, every included file is read into memory and returned on
   * `result.candidateFiles`. Default false — extractors reparse via ts-morph,
   * so pre-reading is wasted I/O for the common path.
   */
  includeContent?: boolean;
}

const CATEGORY_BY_EXTENSION: Record<string, keyof Omit<FileCounts, 'total'>> = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.vue': 'vue',
  '.astro': 'astro',
  '.svelte': 'svelte',
  '.jsx': 'jsx',
  '.js': 'js',
  '.json': 'json',
  '.md': 'md',
};

function emptyCounts(): FileCounts {
  return { tsx: 0, ts: 0, vue: 0, astro: 0, svelte: 0, jsx: 0, js: 0, json: 0, md: 0, other: 0, total: 0 };
}

function categorize(name: string): keyof Omit<FileCounts, 'total'> {
  if (name.endsWith('.d.ts')) return 'other';
  const ext = path.extname(name);
  return CATEGORY_BY_EXTENSION[ext] ?? 'other';
}

function isIncluded(name: string): boolean {
  if (name.endsWith('.d.ts')) return false;
  if (EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return false;
  const ext = path.extname(name);
  if (INCLUDED_EXTENSIONS.has(ext)) return true;
  if (DENYLIST_GATED_EXTENSIONS.has(ext) && !isDenylistedNoiseFile(name)) return true;
  return false;
}

function readEntries(dir: string): Dirent[] | 'unreadable' {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return 'unreadable';
  }
}

function walk(dir: string, result: CollectFilesResult, includeContent: boolean): void {
  const entries = readEntries(dir);
  if (entries === 'unreadable') {
    result.warnings.push(`Could not read directory: ${dir}`);
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(full, result, includeContent);
      continue;
    }
    if (!entry.isFile()) continue;
    const category = categorize(entry.name);
    const included = isIncluded(entry.name);
    if (!included) continue;
    result.counts[category] += 1;
    result.counts.total += 1;
    result.filePaths.push(full);
    if (includeContent) {
      try {
        const content = readFileSync(full, 'utf8');
        (result.candidateFiles ??= []).push({ path: full, content });
      } catch {
        // Pre-read failed but the path is still valid — downstream extractor
        // will try again and surface the real error.
      }
    }
  }
}

function failureFromErrno(code: string | undefined): CollectFilesFailure {
  switch (code) {
    case 'ENOENT':
      return 'not-found';
    case 'EACCES':
    case 'EPERM':
      return 'permission-denied';
    default:
      return 'unreadable';
  }
}

function buildWarnings(counts: FileCounts): string[] {
  const warnings: string[] = [];
  if (counts.total === 0) {
    warnings.push('No source files found. Double-check the path points at your component code.');
    return warnings;
  }
  const componentFiles = counts.tsx + counts.ts + counts.jsx + counts.js + counts.vue + counts.astro + counts.svelte;
  if (componentFiles === 0) {
    warnings.push('No framework source files found (.tsx, .ts, .vue, .svelte, .astro, .jsx, .js).');
  }
  return warnings;
}

/**
 * Walk a project directory and return everything path-validation needs for
 * its summary plus the `filePaths` extract will consume. One walk, no
 * throws — all failure modes land in the discriminated `{ ok: false, failure }`
 * variant so UIs can render a specific message per code.
 *
 * The include-list, denylist-gated extensions, excluded suffixes, and ignored
 * dirs match legacy's `collectSourceFiles` so this is a drop-in replacement
 * for anything that walked a project before.
 */
export function collectFiles(root: string, options: CollectFilesOptions = {}): CollectFilesOutcome {
  const resolved = path.resolve(root);
  let stat;
  try {
    stat = statSync(resolved);
  } catch (err) {
    return { ok: false, failure: failureFromErrno((err as NodeJS.ErrnoException).code), rootPath: resolved };
  }
  if (stat.isFile()) return { ok: false, failure: 'is-file', rootPath: resolved };
  if (!stat.isDirectory()) return { ok: false, failure: 'not-directory', rootPath: resolved };

  const result: CollectFilesResult = {
    filePaths: [],
    counts: emptyCounts(),
    warnings: [],
    rootPath: resolved,
  };
  if (options.includeContent) result.candidateFiles = [];

  walk(resolved, result, options.includeContent === true);
  result.filePaths.sort();
  if (result.candidateFiles) result.candidateFiles.sort((a, b) => a.path.localeCompare(b.path));
  result.warnings.push(...buildWarnings(result.counts));
  return { ok: true, result };
}
