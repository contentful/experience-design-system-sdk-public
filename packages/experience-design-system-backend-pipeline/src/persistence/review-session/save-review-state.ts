import { writeFile } from 'node:fs/promises';
import type { ReviewSessionSnapshot } from './types/review-session.js';

export async function saveReviewState(statePath: string, session: ReviewSessionSnapshot): Promise<void> {
  await writeFile(statePath, JSON.stringify(session, null, 2), 'utf8');
}
