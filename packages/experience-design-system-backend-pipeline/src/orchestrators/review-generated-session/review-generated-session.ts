import { rejectGeneratedComponents } from '../../persistence/src/session/repositories/db.js';
import {
  loadGenerationReviewIssues,
  readGenerationReviewDraft,
} from '../../persistence/src/session/repositories/generation-review-drafts.js';
import type { DatabaseSync } from 'node:sqlite';
import type { ToolCall } from '../../agents/types/tool-calls.js';
import {
  GenerationPreflightError,
  validateGeneratedCDF,
  validateGenerationCalls,
} from '../run-generate-components-session/helpers/validate-generation-preflight.js';
import { buildComponentGraph } from '../../steps/composition/src/helpers/graph/build-component-graph.js';
import { findSlotCycles } from '../../steps/composition/src/helpers/cycles/find-slot-cycles.js';
import { suggestCycleBreakEdge } from '../../steps/composition/src/helpers/cycles/suggest-cycle-break-edge.js';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  loadCDFComponents,
  loadRawComponents,
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
  let storedIssues: typeof generationIssues = [];
  try {
    cdfComponents = loadCDFComponents(db, extractSessionId);
    tokens = loadDTCGTokens(db, tokenSessionId ?? extractSessionId).tokens.map((token) => ({
      path: token.path,
      kind: token.$type,
    }));
    slotCycles = loadSlotCycles(db, extractSessionId);
    storedIssues = loadGenerationReviewIssues(db, extractSessionId);
  } finally {
    db.close();
  }

  if (cdfComponents.length === 0 && generationIssues.length === 0 && storedIssues.length === 0) {
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
  for (const issue of [...generationIssues, ...storedIssues]) {
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
    entries: refreshGeneratedReviewWarnings(extractSessionId, entries),
    tokens,
    error: null,
    slotCycles,
  };
}

/** Recheck retained proposals against the current edits, including restored history. */
export function refreshGeneratedReviewWarnings(
  sessionId: string,
  components: GeneratedReviewEntry[],
): GeneratedReviewEntry[] {
  const db = openPipelineDb();
  try {
    return revalidateReviewWarnings(db, sessionId, components);
  } finally {
    db.close();
  }
}

function revalidateReviewWarnings(
  db: DatabaseSync,
  sessionId: string,
  components: GeneratedReviewEntry[],
): GeneratedReviewEntry[] {
  const raw = loadRawComponents(db, sessionId);
  const rows = db
    .prepare('SELECT name, cdf_schema, status FROM raw_components WHERE session_id = ?')
    .all(sessionId) as Array<{ name: string; cdf_schema: string | null; status: string }>;
  const drafts = new Map(rows.map((row) => [row.name, readGenerationReviewDraft(row.cdf_schema)]));
  return components.map((component) => {
    const draft = drafts.get(component.key);
    const source = raw.find((item) => item.name === component.key);
    if (!draft || !source) return component;
    let generationError: string | undefined;
    try {
      validateGeneratedCDF(component);
      const calls: ToolCall[] = Object.entries(component.entry.$properties)
        .filter(([, property]) => property.$category !== 'unattached')
        .map(([prop, property]) => ({
          tool: 'classify_prop',
          prop,
          cdf_type: property.$type,
          cdf_category: property.$category as 'content' | 'design' | 'state',
          values: property.$values,
          token_kind: property['$token.kind'],
        }));
      for (const [slot, definition] of Object.entries(component.entry.$slots ?? {})) {
        calls.push({ tool: 'classify_slot', slot, allowed_components: definition.$allowedComponents });
      }
      validateGenerationCalls(
        source,
        calls,
        new Set(
          draft.allowedComponentNames ??
            rows.filter((row) => !['rejected', 'generate-rejected'].includes(row.status)).map((row) => row.name),
        ),
        [],
      );
    } catch (error) {
      if (!(error instanceof GenerationPreflightError)) throw error;
      generationError = error.message;
    }
    return { ...component, generationError };
  });
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
      rejectGeneratedComponents(db, extractSessionId, toReject);
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
