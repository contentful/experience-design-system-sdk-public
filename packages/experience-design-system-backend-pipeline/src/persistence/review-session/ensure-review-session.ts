import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { getRefineSessionPaths } from './paths/review-session-paths.js';
import type { ReviewSessionSnapshot } from './types/review-session.js';

export async function ensureRefineSession(
  sessionId: string,
  artifactsRoot: string,
  initialSnapshot: ReviewSessionSnapshot,
): Promise<ReviewSessionSnapshot> {
  const paths = await getRefineSessionPaths(sessionId, artifactsRoot);
  await mkdir(paths.sessionDir, { recursive: true });

  try {
    await access(paths.statePath);
    const savedState = await readFile(paths.statePath, 'utf8');
    return JSON.parse(savedState) as ReviewSessionSnapshot;
  } catch {
    await writeFile(paths.statePath, JSON.stringify(initialSnapshot, null, 2), 'utf8');
    await writeFile(paths.eventsPath, '', 'utf8');
    return initialSnapshot;
  }
}
