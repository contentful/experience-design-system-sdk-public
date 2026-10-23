import type { CandidateFile } from '../../../steps/shared/index.js';

/** Per-category file counts for display. One field per extension family. */
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
 * The successful result of a project scan. One walk, three consumers:
 *   - extractors read `filePaths`
 *   - UIs render `counts` + `warnings`
 *   - callers that pre-read content opt in via `candidateFiles`
 */
export interface CollectFilesResult {
  /** Absolute paths of files that pass the walk filters. Sorted. */
  filePaths: string[];
  /** Per-category totals. Sums to `total`. */
  counts: FileCounts;
  /** Advisory messages for display. Empty on a healthy project. */
  warnings: string[];
  /** The resolved walk root. Callers can echo this back to the user. */
  rootPath: string;
  /**
   * Full `{ path, content }` records when the caller passed
   * `{ includeContent: true }`. Undefined otherwise.
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
