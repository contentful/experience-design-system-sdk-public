import { buildComponentGraph } from '../../steps/composition/src/helpers/graph/build-component-graph.js';
import { findSlotCycles } from '../../steps/composition/src/helpers/cycles/find-slot-cycles.js';
import { suggestCycleBreakEdge } from '../../steps/composition/src/helpers/cycles/suggest-cycle-break-edge.js';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  loadCDFComponents,
  loadDTCGTokens,
  loadSlotCycles,
  openPipelineDb,
  storeCDFComponents,
  storeSlotCycles,
  loadComponentReviewMetadata,
  loadComponentRationale,
  type ComponentReviewMetadata,
  type ComponentRationale,
  type StoredSlotCycle,
} from '../../persistence/src/index.js';
import type {
  GeneratedReviewEntry,
  GeneratedReviewSession,
  LoadGeneratedReviewSessionOptions,
  ReviewFinalizeCounts,
  ReviewToken,
} from './types.js';

export function loadReviewSessionState({
  extractSessionId,
  tokenSessionId,
  generationIssues = [],
}: LoadGeneratedReviewSessionOptions): GeneratedReviewSession {
  const db = openPipelineDb();
  let cdfComponents: Array<{ key: string; entry: CDFComponentEntry }> = [];
  let tokens: ReviewToken[] = [];
  let slotCycles: StoredSlotCycle[] = [];
  try {
    cdfComponents = loadCDFComponents(db, extractSessionId);
    tokens = loadDTCGTokens(db, tokenSessionId ?? extractSessionId).tokens.map((token) => ({
      path: token.path,
      kind: token.$type,
    }));
    slotCycles = loadSlotCycles(db, extractSessionId);
  } finally {
    db.close();
  }

  if (cdfComponents.length === 0 && generationIssues.length === 0) {
    return {
      entries: [],
      tokens: [],
      error: 'No generated definitions found for this session. Try re-running generate.',
      slotCycles,
    };
  }

  const entries: GeneratedReviewEntry[] = cdfComponents.map(({ key, entry }) => ({
    key,
    entry,
    status: 'needs-review' as const,
  }));
  for (const issue of generationIssues) {
    const existing = entries.find((component) => component.key === issue.componentName);
    if (existing) existing.generationError = issue.error;
    else {
      entries.push({
        key: issue.componentName,
        entry: { $type: 'component', $properties: {} },
        status: 'needs-review',
        generationError: issue.error,
      });
    }
  }

  return {
    entries,
    tokens,
    error: null,
    slotCycles,
  };
}

export function finalizeReviewSession(
  extractSessionId: string,
  components: GeneratedReviewEntry[],
): ReviewFinalizeCounts {
  const accepted = components.filter((component) => component.status === 'accepted').length;
  const rejectedKeys = components
    .filter((component) => component.status === 'rejected')
    .map((component) => component.key);
  const unresolvedKeys = components
    .filter((component) => component.status === 'needs-review')
    .map((component) => component.key);
  const toReject = [...rejectedKeys, ...unresolvedKeys];

  if (toReject.length > 0) {
    const db = openPipelineDb();
    try {
      const statement = db.prepare(
        `UPDATE raw_components SET status = 'generate-rejected' WHERE session_id = ? AND name = ?`,
      );
      db.exec('BEGIN');
      try {
        for (const name of toReject) statement.run(extractSessionId, name);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      db.close();
    }
  }

  return {
    accepted,
    rejected: rejectedKeys.length,
    unresolved: unresolvedKeys.length,
  };
}

export function saveGeneratedReviewComponent(sessionId: string, key: string, entry: CDFComponentEntry): void {
  const db = openPipelineDb();
  try {
    storeCDFComponents(db, sessionId, [{ key, entry }]);
  } finally {
    db.close();
  }
}

export function saveGeneratedReviewDraft(sessionId: string, key: string, draft: string): CDFComponentEntry {
  const parsed = JSON.parse(draft) as Record<string, unknown>;
  const keys = Object.keys(parsed);
  const entry =
    keys.length === 1 && typeof parsed[keys[0]] === 'object' && parsed[keys[0]] !== null
      ? (parsed[keys[0]] as CDFComponentEntry)
      : (parsed as unknown as CDFComponentEntry);
  if (entry.$type !== 'component' || typeof entry.$properties !== 'object' || entry.$properties === null) {
    throw new Error('Invalid CDF entry: must have $type: "component" and $properties object');
  }
  saveGeneratedReviewComponent(sessionId, key, entry);
  return entry;
}

export function loadGeneratedReviewMetadata(
  sessionId: string,
  key: string,
): {
  metadata: ComponentReviewMetadata | null;
  rationale: ComponentRationale | null;
} {
  const db = openPipelineDb();
  let metadata: ComponentReviewMetadata | null = null;
  let rationale: ComponentRationale | null = null;
  try {
    try {
      metadata = loadComponentReviewMetadata(db, sessionId, key);
    } catch {
      metadata = null;
    }
    try {
      rationale = loadComponentRationale(db, sessionId, key);
    } catch {
      rationale = null;
    }
    return { metadata, rationale };
  } finally {
    db.close();
  }
}

export function refreshGeneratedReviewCycles(sessionId: string, components: GeneratedReviewEntry[]): StoredSlotCycle[] {
  const graph = buildComponentGraph(components.filter((component) => component.status !== 'rejected'));
  const cycles = findSlotCycles(graph);
  const next = cycles.map((cycle) => ({
    ...cycle,
    suggestedBreak: cycle.edges.length > 0 ? suggestCycleBreakEdge(cycle, cycles) : null,
  }));
  const db = openPipelineDb();
  try {
    if (JSON.stringify(loadSlotCycles(db, sessionId)) !== JSON.stringify(next)) {
      storeSlotCycles(db, sessionId, next);
    }
  } finally {
    db.close();
  }
  return next;
}
