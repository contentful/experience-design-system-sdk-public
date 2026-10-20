import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  loadRawComponents,
  applyScopeDecisions,
} from '../src/session/repositories/db.js';
import { writeScopeDecisionsSnapshot } from '../src/review-session/services/write-scope-decisions-snapshot.js';
import { getRefineSessionPaths } from '../src/review-session/repositories/review-session-paths.js';
import { createReviewSessionSummary } from '../src/review-session/helpers/create-review-session-summary.js';
import { saveReviewState } from '../src/review-session/repositories/save-review-state.js';
import { ensureRefineSession } from '../src/review-session/repositories/ensure-review-session.js';
import type { ReviewSessionSnapshot } from '../src/review-session/types/review-session.js';

it('omits score from new SQL writes and old reopened models/snapshots/summary while preserving reasons and proposals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'scoreless-saves-'));
  const dbPath = join(root, 'pipeline.db');
  const previous = process.env.EDS_REVIEW_ARTIFACTS_DIR;
  process.env.EDS_REVIEW_ARTIFACTS_DIR = join(root, 'reviews');
  try {
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    const component = {
      name: 'Panel',
      source: '/example/Panel.tsx',
      sourcePath: '/example/Panel.tsx',
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [],
      needsReview: true,
      reviewReasons: ['props-type-unresolved'],
      extractionConfidence: 1,
    };
    storeRawComponents(db, sessionId, [component]);
    const row = db.prepare('SELECT extraction_confidence FROM raw_components WHERE session_id = ?').get(sessionId)!;
    expect(row.extraction_confidence).toBeNull();
    db.prepare('UPDATE raw_components SET extraction_confidence = 2 WHERE session_id = ?').run(sessionId);
    db.close();
    const reopened = openPipelineDb(dbPath);
    try {
      const loaded = loadRawComponents(reopened, sessionId)[0]!;
      expect(loaded).not.toHaveProperty('extractionConfidence');
      expect(loaded).toMatchObject({
        sourcePath: component.sourcePath,
        props: component.props,
        reviewReasons: component.reviewReasons,
        needsReview: true,
      });
      expect(
        reopened.prepare('SELECT extraction_confidence FROM raw_components WHERE session_id = ?').get(sessionId)!
          .extraction_confidence,
      ).toBe(2);
      applyScopeDecisions(reopened, sessionId, { accepted: ['Panel'], rejected: [] });
      await writeScopeDecisionsSnapshot(reopened, sessionId);
      const paths = await getRefineSessionPaths(sessionId, process.env.EDS_REVIEW_ARTIFACTS_DIR);
      const snapshot: ReviewSessionSnapshot = JSON.parse(readFileSync(paths.statePath, 'utf8'));
      expect(snapshot.components[0]!.editedProposal).not.toHaveProperty('extractionConfidence');
      expect(snapshot.components[0]!.editedProposal).toMatchObject({
        reviewReasons: component.reviewReasons,
        needsReview: true,
        props: component.props,
      });
      const historical: ReviewSessionSnapshot = {
        ...snapshot,
        components: snapshot.components.map((item) => ({
          ...item,
          originalProposal: { ...item.originalProposal, extractionConfidence: 2 },
        })),
      };
      await saveReviewState(paths.statePath, historical);
      const restored = await ensureRefineSession(sessionId, process.env.EDS_REVIEW_ARTIFACTS_DIR!, { components: [] });
      expect(restored).toEqual(historical);
      expect(restored.components[0]!.status).toBe('accepted');
      expect(restored.components[0]!.scopeProvenance).toEqual(snapshot.components[0]!.scopeProvenance);
      const summary = createReviewSessionSummary(restored);
      expect(summary.components[0]).not.toHaveProperty('extractionConfidence');
      expect(summary.components[0]!.needsReview).toBe(true);
    } finally {
      reopened.close();
    }
  } finally {
    if (previous === undefined) delete process.env.EDS_REVIEW_ARTIFACTS_DIR;
    else process.env.EDS_REVIEW_ARTIFACTS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
