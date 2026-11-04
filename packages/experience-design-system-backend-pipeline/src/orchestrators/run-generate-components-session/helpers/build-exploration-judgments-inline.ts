import type { DatabaseSync } from 'node:sqlite';
import type { ExplorationDetailRecord } from '@contentful/experience-design-system-types';
import type { RawComponentWithId } from '../../../persistence/src/session/repositories/db.js';
import {
  loadExplorationRecord,
  loadExplorationReports,
  loadExplorationRun,
} from '../../../persistence/src/session/repositories/exploration/records.js';
import { explorationFieldPath } from '../../../steps/exploration/src/services/diff-exploration.js';

export function buildExplorationJudgmentsInline(
  db: DatabaseSync,
  sessionId: string,
  component: RawComponentWithId,
  expectedRunIds: { componentRunId: string; detailRunId: string },
): string {
  const run = loadExplorationRun(db, sessionId, 'detail');
  const detail = loadExplorationRecord<ExplorationDetailRecord>(db, sessionId, 'detail', 'detail');
  if (!detail || run?.runId !== expectedRunIds.detailRunId || run.componentRunId !== expectedRunIds.componentRunId)
    throw new Error('Current reconciled exploration judgments unavailable');

  const owns = (item: { component: string; source: string }): boolean =>
    item.component === component.name && item.source === component.source;
  const prefix = explorationFieldPath(component.name, component.source, 'component', undefined, '');
  const disagreements = detail.diff.disagreements.filter(owns);
  const disagreementIds = new Set(disagreements.map((item) => item.id));
  const verified = detail.verified.filter(owns);
  const itemIds = new Set(verified.map((item) => item.itemId));
  const modelingNotes = loadExplorationReports(db, sessionId, 'detail').flatMap((report) =>
    report.companion.components
      .filter(
        (item) =>
          item.componentId === component.component_id &&
          item.name === component.name &&
          item.source === component.source &&
          item.modelingNotes?.length,
      )
      .map((item) => ({ scope: report.scope, notes: item.modelingNotes })),
  );

  return JSON.stringify({
    component: { componentId: component.component_id, name: component.name, source: component.source },
    provenance: {
      componentRunId: run.componentRunId,
      detailRunId: run.runId,
      envelopeId: run.envelopeId,
      sourceDigest: run.digest,
    },
    advisoryOnly: true,
    consensus: detail.diff.consensus.filter((item) => item.path.startsWith(prefix)),
    checkedJudgments: verified,
    evidenceChecks: detail.checks.filter((item) => owns(item) && itemIds.has(item.itemId)),
    reportedDisagreements: disagreements,
    singleReporterClaims: detail.diff.singleVoters.filter(owns),
    hypotheses: detail.hypotheses.flatMap((item) => {
      const ids = item.disagreementIds.filter((id) => disagreementIds.has(id));
      return ids.length ? [{ ...item, disagreementIds: ids }] : [];
    }),
    modelingNotes,
  });
}
