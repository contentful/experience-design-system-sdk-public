import { mkdir } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import type { RawComponentDefinition } from '../../../../steps/extraction/src/types/component.js';
import { loadRawComponents, loadScopeDecisions, loadSavedSharedSource } from '../../session/repositories/db.js';
import { loadExplorationRun } from '../../session/repositories/exploration/records.js';
import { getRefineArtifactsRoot } from '../repositories/review-artifacts-root.js';
import { getRefineSessionPaths } from '../repositories/review-session-paths.js';
import { saveReviewState } from '../repositories/save-review-state.js';
import type { ReviewComponentRecord, ReviewComponentStatus } from '../types/review-component.js';

/**
 * Legacy generation reads scope from the review snapshot. Completed exploration
 * uses authoritative database scope decisions directly and needs no duplicate snapshot.
 */
export async function writeScopeDecisionsSnapshot(db: DatabaseSync, sessionId: string): Promise<void> {
  const decisions = loadScopeDecisions(db, sessionId);
  if (!decisions) throw new Error(`No saved scope decisions found for session ${sessionId}`);
  const exploration = loadExplorationRun(db, sessionId, 'components');
  if (exploration) {
    if (exploration.status !== 'complete') throw new Error('Component exploration must complete before saving scope.');
    return;
  }
  const acceptedSet = new Set(decisions.accepted);
  const rawComponents = loadRawComponents(db, sessionId);
  const records: ReviewComponentRecord[] = rawComponents.map((c) => {
    const status: ReviewComponentStatus = acceptedSet.has(c.name) ? 'accepted' : 'rejected';
    const proposal: RawComponentDefinition = {
      name: c.name,
      source: c.source,
      sourcePath: c.sourcePath,
      framework: c.framework,
      props: c.props,
      slots: c.slots,
      ...(c.componentFacts !== undefined ? { componentFacts: c.componentFacts } : {}),
      ...(c.componentEvidenceReadStatus !== undefined
        ? { componentEvidenceReadStatus: c.componentEvidenceReadStatus }
        : {}),
      ...(c.factSchemaVersion !== undefined ? { factSchemaVersion: c.factSchemaVersion } : {}),
      ...(c.sourceCandidates !== undefined ? { sourceCandidates: c.sourceCandidates } : {}),
      ...(c.sourceCandidateSources !== undefined ? { sourceCandidateSources: c.sourceCandidateSources } : {}),
      ...(c.sourceEvidenceReadStatus !== undefined ? { sourceEvidenceReadStatus: c.sourceEvidenceReadStatus } : {}),
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
      ...(status === 'accepted'
        ? { scopeProvenance: decisions.acceptedProvenance?.[c.name] ?? { kind: 'unknown', roots: [] } }
        : {}),
    };
  });

  const paths = await getRefineSessionPaths(sessionId, getRefineArtifactsRoot());
  await mkdir(paths.sessionDir, { recursive: true });
  await saveReviewState(paths.statePath, { components: records, sourceEvidence: loadSavedSharedSource(db, sessionId) });
}
