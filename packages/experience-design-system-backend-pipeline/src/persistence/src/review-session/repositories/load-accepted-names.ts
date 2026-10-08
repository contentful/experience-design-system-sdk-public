import { readFile } from 'node:fs/promises';
import { getRefineArtifactsRoot } from './review-artifacts-root.js';
import { getRefineSessionPaths } from './review-session-paths.js';
import type { ReviewSessionSnapshot } from '../types/review-session.js';

/**
 * Load the set of component names a reviewer accepted for a given session.
 * Returns `null` when the state file is missing, unreadable, or has zero
 * accepted entries — downstream code uses that signal to fall back to
 * "all components" rather than silently drop the batch.
 */
export async function loadAcceptedNames(sessionId: string): Promise<Set<string> | null> {
  try {
    const artifactsRoot = getRefineArtifactsRoot();
    const paths = await getRefineSessionPaths(sessionId, artifactsRoot);
    const raw = await readFile(paths.statePath, 'utf8');
    const snapshot = JSON.parse(raw) as ReviewSessionSnapshot;
    const accepted = snapshot.components.filter((c) => c.status === 'accepted').map((c) => c.name);
    if (accepted.length === 0) return null;
    return new Set(accepted);
  } catch {
    return null;
  }
}
