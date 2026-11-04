import { getRefineArtifactsRoot } from './review-artifacts-root.js';
import { getRefineSessionPaths } from './review-session-paths.js';
import { readReviewState } from './read-review-state.js';

/** Missing state permits an unfiltered batch; a valid empty selection selects nothing. */
export async function loadAcceptedNames(sessionId: string): Promise<Set<string> | null> {
  const paths = await getRefineSessionPaths(sessionId, getRefineArtifactsRoot());
  const snapshot = await readReviewState(paths.statePath);
  if (snapshot === undefined) return null;
  return new Set(snapshot.components.filter((c) => c.status === 'accepted').map((c) => c.name));
}
