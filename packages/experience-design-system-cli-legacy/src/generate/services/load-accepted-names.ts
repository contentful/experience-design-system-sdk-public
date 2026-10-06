import { readFile } from 'node:fs/promises';
import { getRefineArtifactsRoot, getRefineSessionPaths } from '../../analyze/select/persistence.js';
import type { ReviewSessionSnapshot } from '../../analyze/select/types.js';

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
