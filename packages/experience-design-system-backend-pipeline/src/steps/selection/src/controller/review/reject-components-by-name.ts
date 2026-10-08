import { readFile } from 'node:fs/promises';
import { openPipelineDb } from '../../../../../persistence/src/session/repositories/db.js';
import { getRefineArtifactsRoot } from '../../../../../persistence/src/review-session/repositories/review-artifacts-root.js';
import { getRefineSessionPaths } from '../../../../../persistence/src/review-session/repositories/review-session-paths.js';
import { saveReviewState } from '../../../../../persistence/src/review-session/repositories/save-review-state.js';
import type { ReviewSessionSnapshot } from '../../../../../persistence/src/review-session/types/review-session.js';

/**
 * Exclude components whose names appear in `names` from the next preview/push.
 * Used by the wizard's "skip and retry" path after a 422.
 */
export async function rejectComponentsByName(
  sessionId: string,
  names: string[],
  opts: { artifactsRoot?: string } = {},
): Promise<void> {
  if (names.length === 0) return;

  const db = openPipelineDb();
  try {
    const placeholders = names.map(() => '?').join(',');
    db.prepare(
      `UPDATE raw_components SET status = 'generate-rejected' WHERE session_id = ? AND name IN (${placeholders})`,
    ).run(sessionId, ...names);
  } finally {
    db.close();
  }

  const artifactsRoot = opts.artifactsRoot ?? getRefineArtifactsRoot();
  const paths = await getRefineSessionPaths(sessionId, artifactsRoot);
  const nameSet = new Set(names);

  let snapshot: ReviewSessionSnapshot;
  try {
    snapshot = JSON.parse(await readFile(paths.statePath, 'utf8')) as ReviewSessionSnapshot;
  } catch {
    return;
  }

  const components = snapshot.components.map((c) => (nameSet.has(c.name) ? { ...c, status: 'rejected' as const } : c));
  await saveReviewState(paths.statePath, { ...snapshot, components });
}
