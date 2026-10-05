import { relative } from 'node:path';
import type { RawComponentDefinition } from '../../types.js';
import { storeRawComponents, storeSlotCycles, storeScannedFiles, updateStep } from '../../session/db.js';
import type { openPipelineDb } from '../../session/db.js';
import type { SourceCallSiteEvidence, SourceCallSiteRejection } from '../composition/source-call-site-evidence.js';
import { findSlotCycles, suggestCycleBreakEdge } from '../cycle-detection.js';
import { retryDatabaseWrite } from '../helpers/retry-db-write.js';

export interface PersistExtractResultsOptions {
  db: ReturnType<typeof openPipelineDb>;
  sessionId: string;
  stepId: number;
  projectRoot: string;
  sourceFiles: string[];
  components: RawComponentDefinition[];
  sourceCallSiteEvidence: SourceCallSiteEvidence[];
  sourceCallSiteRejections: SourceCallSiteRejection[];
}

export async function persistExtractResults(options: PersistExtractResultsOptions): Promise<void> {
  const { db, sessionId, stepId, projectRoot, sourceFiles, components, sourceCallSiteEvidence, sourceCallSiteRejections } = options;

  await retryDatabaseWrite(() => storeRawComponents(db, sessionId, components, { preserveStatus: true }));

  const cycleInput = components.map((c) => ({
    name: c.name,
    slots: c.slots.map((s) => ({ name: s.name, allowedComponents: s.allowedComponents })),
  }));
  const cycles = findSlotCycles(cycleInput);
  const withBreaks = cycles.map((cycle) => ({
    ...cycle,
    suggestedBreak: suggestCycleBreakEdge(cycle, cycles),
  }));
  await retryDatabaseWrite(() => storeSlotCycles(db, sessionId, withBreaks));

  storeScannedFiles(
    db,
    sessionId,
    sourceFiles.map((f) => relative(projectRoot, f)),
  );

  await retryDatabaseWrite(() =>
    updateStep(db, stepId, 'complete', {
      sessionId,
      compositionEvidence: JSON.stringify(sourceCallSiteEvidence),
      compositionRejections: JSON.stringify(sourceCallSiteRejections),
    }),
  );
}
