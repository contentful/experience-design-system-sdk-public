import { access, readFile } from 'node:fs/promises';
import { getRefineArtifactsRoot, ensureRefineSession, getRefineSessionPaths, saveReviewState } from './persistence.js';
import { loadReviewInput } from './parser.js';
import type { ReviewSessionSnapshot } from './types.js';
import { openPipelineDb, loadRawComponents } from '../../session/db.js';
import { validateExtractedComponents } from '@contentful/experience-design-system-extraction';
import type { PreviewValidationError } from '../../apply/api-client.js';
import type { ExtractionValidationIssue } from '../../types.js';

/**
 * Load components from the pipeline DB and re-run extraction validation.
 *
 * `validationIssues` is intentionally not persisted (the validator is pure
 * and cheap to re-run), so any cold-start of the review state needs to
 * recompute it before building the review snapshot.
 */
export async function loadAndValidateForReview(
  sessionId: string,
  projectRoot: string | undefined,
): Promise<ReviewSessionSnapshot> {
  const db = openPipelineDb();
  let rawComponents;
  try {
    rawComponents = loadRawComponents(db, sessionId);
  } finally {
    db.close();
  }
  const validatedComponents = validateExtractedComponents(rawComponents);
  return loadReviewInput(validatedComponents, { reviewRoot: projectRoot });
}

/**
 * Synthesize SERVER_VALIDATION_FAILED issues onto the review state file's
 * matching components for the wizard's 422 recovery path.
 */
export async function patchReviewStateWithValidationErrors(
  sessionId: string,
  errors: PreviewValidationError[],
  opts: { artifactsRoot?: string } = {},
): Promise<{ patchedNames: string[]; missingNames: string[] }> {
  const artifactsRoot = opts.artifactsRoot ?? getRefineArtifactsRoot();
  const paths = await getRefineSessionPaths(sessionId, artifactsRoot);

  let snapshot: ReviewSessionSnapshot;
  try {
    await access(paths.statePath);
    snapshot = JSON.parse(await readFile(paths.statePath, 'utf8')) as ReviewSessionSnapshot;
  } catch {
    snapshot = await loadAndValidateForReview(sessionId, undefined);
    snapshot = await ensureRefineSession(sessionId, artifactsRoot, snapshot);
  }

  const errorsByName = new Map<string, PreviewValidationError[]>();
  for (const err of errors) {
    const list = errorsByName.get(err.componentName) ?? [];
    list.push(err);
    errorsByName.set(err.componentName, list);
  }

  const patchedNames: string[] = [];
  const knownNames = new Set(snapshot.components.map((c) => c.name));
  const components = snapshot.components.map((c) => {
    const matched = errorsByName.get(c.name);
    if (!matched || matched.length === 0) return c;
    patchedNames.push(c.name);
    const newIssues: ExtractionValidationIssue[] = matched.map((err) => ({
      severity: 'error',
      code: 'SERVER_VALIDATION_FAILED',
      message: err.message,
    }));
    const existing = c.originalProposal.validationIssues ?? [];
    return {
      ...c,
      originalProposal: {
        ...c.originalProposal,
        validationIssues: [...existing, ...newIssues],
      },
    };
  });

  const missingNames = [...errorsByName.keys()].filter((n) => !knownNames.has(n));

  await saveReviewState(paths.statePath, { ...snapshot, components });

  return { patchedNames, missingNames };
}

/**
 * Exclude components whose names appear in `names` from the next preview/push.
 * Used by the wizard's "skip and retry" path after a 422.
 */
export async function rejectComponentsByName(
  sessionId: string,
  names: string[],
  opts: { artifactsRoot?: string } = {},
): Promise<void> {
  if (names.length === 0) return;

  const db = openPipelineDb();
  try {
    const placeholders = names.map(() => '?').join(',');
    db.prepare(
      `UPDATE raw_components SET status = 'generate-rejected' WHERE session_id = ? AND name IN (${placeholders})`,
    ).run(sessionId, ...names);
  } finally {
    db.close();
  }

  const artifactsRoot = opts.artifactsRoot ?? getRefineArtifactsRoot();
  const paths = await getRefineSessionPaths(sessionId, artifactsRoot);
  const nameSet = new Set(names);

  let snapshot: ReviewSessionSnapshot;
  try {
    snapshot = JSON.parse(await readFile(paths.statePath, 'utf8')) as ReviewSessionSnapshot;
  } catch {
    return;
  }

  const components = snapshot.components.map((c) => (nameSet.has(c.name) ? { ...c, status: 'rejected' as const } : c));
  await saveReviewState(paths.statePath, { ...snapshot, components });
}
