import { readFile } from 'node:fs/promises';
import type { ReviewSessionSnapshot } from '../types/review-session.js';

export async function readReviewState(path: string): Promise<ReviewSessionSnapshot | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ReviewSessionSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Unable to read review state at ${path}. Check the file contents and permissions.`, {
      cause: error,
    });
  }
}
