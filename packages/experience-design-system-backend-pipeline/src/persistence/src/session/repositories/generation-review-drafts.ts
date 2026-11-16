import type { DatabaseSync } from 'node:sqlite';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import type { GenerationIssue } from '@contentful/experience-design-system-types/handoff';
import { withTransaction } from './shared/with-transaction.js';

export type GenerationReviewDraft = { entry: CDFComponentEntry; error: string; agentOutput: string };

export function readGenerationReviewDraft(serialized: string | null): GenerationReviewDraft | null {
  if (!serialized) return null;
  const draft = JSON.parse(serialized) as GenerationReviewDraft;
  return draft.entry && typeof draft.error === 'string' ? draft : null;
}

export function storeGenerationReviewDraft(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  draft: GenerationReviewDraft,
): void {
  withTransaction(db, () => {
    db.prepare(
      "UPDATE raw_components SET status = 'generated', cdf_schema = ? WHERE session_id = ? AND component_id = ?",
    ).run(JSON.stringify(draft), sessionId, componentId);
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), sessionId);
  });
}

export function loadGenerationReviewIssues(db: DatabaseSync, sessionId: string): GenerationIssue[] {
  const rows = db
    .prepare(
      "SELECT name, cdf_schema FROM raw_components WHERE session_id = ? AND status = 'generated' AND cdf_schema IS NOT NULL",
    )
    .all(sessionId) as Array<{ name: string; cdf_schema: string }>;
  return rows.flatMap((row) => {
    const draft = readGenerationReviewDraft(row.cdf_schema);
    return draft ? [{ componentName: row.name, error: draft.error }] : [];
  });
}
