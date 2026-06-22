import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { loadRawComponents } from '../../session/db.js';
import type { RawComponentDefinition } from '../../types.js';
import type {
  ReviewComponentRecord,
  ReviewComponentStatus,
  ReviewEvent,
  ReviewSessionPaths,
  ReviewSessionSnapshot,
} from './types.js';

export function getRefineArtifactsRoot(): string {
  if (process.env.EDS_REVIEW_ARTIFACTS_DIR) {
    return resolve(process.env.EDS_REVIEW_ARTIFACTS_DIR);
  }
  return resolve(homedir(), '.contentful', 'experience-design-system-cli', 'reviews');
}

export async function getRefineSessionPaths(sessionId: string, artifactsRoot: string): Promise<ReviewSessionPaths> {
  const sessionDir = resolve(artifactsRoot, sessionId);

  return {
    sessionDir,
    eventsPath: resolve(sessionDir, 'events.jsonl'),
    statePath: resolve(sessionDir, 'current-review-state.json'),
  };
}

export async function saveReviewState(statePath: string, session: ReviewSessionSnapshot): Promise<void> {
  await writeFile(statePath, JSON.stringify(session, null, 2), 'utf8');
}

export async function appendReviewEvent(
  eventsPath: string,
  event: { type: string; payload: Record<string, unknown> },
): Promise<void> {
  const record: ReviewEvent = {
    type: event.type,
    timestamp: new Date().toISOString(),
    payload: event.payload,
  };
  await appendFile(eventsPath, JSON.stringify(record) + '\n', 'utf8');
}

export async function ensureRefineSession(
  sessionId: string,
  artifactsRoot: string,
  initialSnapshot: ReviewSessionSnapshot,
): Promise<ReviewSessionSnapshot> {
  const paths = await getRefineSessionPaths(sessionId, artifactsRoot);
  await mkdir(paths.sessionDir, { recursive: true });

  try {
    await access(paths.statePath);
    const savedState = await readFile(paths.statePath, 'utf8');
    return JSON.parse(savedState) as ReviewSessionSnapshot;
  } catch {
    await writeFile(paths.statePath, JSON.stringify(initialSnapshot, null, 2), 'utf8');
    await writeFile(paths.eventsPath, '', 'utf8');
    return initialSnapshot;
  }
}

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
