import type { CollectFilesFailure } from '../../types/collect-files-result.js';

/** Map a Node fs errno to one of the typed failure codes `collectFiles` returns. */
export function classifyStatError(code: string | undefined): CollectFilesFailure {
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
