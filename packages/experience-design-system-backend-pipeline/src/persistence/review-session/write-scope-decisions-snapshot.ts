import { mkdir } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import type { RawComponentDefinition } from '../../steps/extraction/src/types/component.js';
import { loadRawComponents } from '../session/db.js';
import { getRefineArtifactsRoot } from './paths/review-artifacts-root.js';
import { getRefineSessionPaths } from './paths/review-session-paths.js';
import { saveReviewState } from './save-review-state.js';
import type { ReviewComponentRecord, ReviewComponentStatus } from './types/review-component.js';

/**
 * Persist scope-gate decisions to `current-review-state.json` so downstream
 * consumers (notably `loadAcceptedNames` in `generate components`) can filter
 * out rejected components. The wizard's scope-gate doesn't drive the rich
 * `analyze select` TUI, so fields that file consumes (resolvedSourcePath,
 * sourceCode) are populated with safe placeholders. Only `name` and `status`
 * matter for `loadAcceptedNames`.
 */
export async function writeScopeDecisionsSnapshot(
  db: DatabaseSync,
  sessionId: string,
  decisions: { accepted: string[]; rejected: string[] },
): Promise<void> {
  const acceptedSet = new Set(decisions.accepted);
  const rawComponents = loadRawComponents(db, sessionId);
  const records: ReviewComponentRecord[] = rawComponents.map((c) => {
    const status: ReviewComponentStatus = acceptedSet.has(c.name) ? 'accepted' : 'rejected';
    const proposal: RawComponentDefinition = {
      name: c.name,
      source: c.source,
      framework: c.framework,
      props: c.props,
      slots: c.slots,
      ...(c.extractionConfidence !== undefined ? { extractionConfidence: c.extractionConfidence } : {}),
      ...(c.reviewReasons !== undefined ? { reviewReasons: c.reviewReasons } : {}),
      ...(c.needsReview !== undefined ? { needsReview: c.needsReview } : {}),
    };
    return {
      id: c.component_id,
      name: c.name,
      resolvedSourcePath: '',
      sourceCode: null,
      originalProposal: proposal,
      editedProposal: proposal,
      status,
    };
  });

  const paths = await getRefineSessionPaths(sessionId, getRefineArtifactsRoot());
  await mkdir(paths.sessionDir, { recursive: true });
  await saveReviewState(paths.statePath, { components: records });
}
