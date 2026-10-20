import { mkdir, writeFile } from 'node:fs/promises';
import { readReviewState } from './read-review-state.js';
import { getRefineSessionPaths } from './review-session-paths.js';
import type { ReviewSessionSnapshot } from '../types/review-session.js';

export async function ensureRefineSession(
  sessionId: string,
  artifactsRoot: string,
  initialSnapshot: ReviewSessionSnapshot,
): Promise<ReviewSessionSnapshot> {
  const paths = await getRefineSessionPaths(sessionId, artifactsRoot);
  await mkdir(paths.sessionDir, { recursive: true });

  const savedState = await readReviewState(paths.statePath);
  if (savedState !== undefined) return savedState;
  await writeFile(paths.statePath, JSON.stringify(initialSnapshot, null, 2), 'utf8');
  await writeFile(paths.eventsPath, '', 'utf8');
  return initialSnapshot;
}
