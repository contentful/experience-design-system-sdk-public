import type { FileCounts } from '../../types/collect-files-result.js';

/** Zero-initialised `FileCounts` — one allocation per `collectFiles` call. */
export function emptyFileCounts(): FileCounts {
  return { tsx: 0, ts: 0, vue: 0, astro: 0, svelte: 0, jsx: 0, js: 0, json: 0, md: 0, other: 0, total: 0 };
}
