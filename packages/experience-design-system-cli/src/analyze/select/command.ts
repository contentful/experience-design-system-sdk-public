import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { render } from 'ink';
import type { Command } from 'commander';
import { getRefineArtifactsRoot, ensureRefineSession, getRefineSessionPaths, saveReviewState } from './persistence.js';
import { loadReviewInput } from './parser.js';
import { App } from './tui/App.js';
import type { ReviewSessionPaths, ReviewSessionSnapshot } from './types.js';
import { openPipelineDb, loadRawComponents, storeRawComponents, createStep, updateStep } from '../../session/db.js';
import {
  validateExtractedComponents,
  shouldExcludeDueToValidation,
  formatExclusionWarning,
} from '../extract/validate.js';
import type { RawComponentDefinition } from '../../types.js';
import type { PreviewValidationError } from '../../apply/api-client.js';
import type { ExtractionValidationIssue } from '../../types.js';

type RefineCommandOptions = {
  session?: string;
  projectRoot?: string;
  acceptAll?: boolean;
  selectAll?: boolean;
  reject?: string[];
  deselect?: string[];
  select?: string[];
  patch?: string;
  excludeInvalid?: boolean;
};

interface PatchOperation {
  component: string;
  status?: 'accepted' | 'rejected';
  set?: Record<string, unknown>;
}

const SAFE_PATH_RE = /^[a-zA-Z0-9_.$[\]=]+$/;
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function applyDotPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!SAFE_PATH_RE.test(path)) {
    process.stderr.write(`Warning: --patch path contains invalid characters: '${path}', skipping\n`);
    return;
  }
  const parts = path.split('.');
  if (parts.some((p) => PROTO_KEYS.has(p))) {
    process.stderr.write(`Warning: --patch path contains forbidden key: '${path}', skipping\n`);
    return;
  }
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    // Handle array predicate syntax: field[name=value]
    const arrayMatch = /^(.+)\[name=(.+)\]$/.exec(part);
    if (arrayMatch) {
      const [, fieldName, matchValue] = arrayMatch;
      const arr = current[fieldName!] as Array<Record<string, unknown>>;
      if (Array.isArray(arr)) {
        const item = arr.find((el) => el['name'] === matchValue);
        if (item) {
          current = item;
        } else {
          process.stderr.write(
            `Warning: --patch array item [name=${matchValue}] not found in '${fieldName}', skipping\n`,
          );
          return;
        }
      }
    } else {
      if (typeof current[part] !== 'object' || current[part] === null) {
        process.stderr.write(`Warning: --patch path '${path}' — '${part}' is not an object, skipping\n`);
        return;
      }
      current = current[part] as Record<string, unknown>;
    }
  }
  const lastPart = parts[parts.length - 1]!;
  current[lastPart] = value;
}

function applyPatch(snapshot: ReviewSessionSnapshot, ops: PatchOperation[]): ReviewSessionSnapshot {
  const components = snapshot.components.map((c) => {
    const op = ops.find((o) => o.component === c.name);
    if (!op) return c;

    let updated = { ...c };
    if (op.status) {
      updated = { ...updated, status: op.status };
    }
    if (op.set) {
      const editedProposal = structuredClone(updated.editedProposal) as unknown as Record<string, unknown>;
      for (const [path, value] of Object.entries(op.set)) {
        applyDotPath(editedProposal, path, value);
      }
      updated = {
        ...updated,
        editedProposal: editedProposal as unknown as typeof updated.editedProposal,
      };
    }
    return updated;
  });
  return { ...snapshot, components };
}

async function runNonInteractive(
  snapshot: ReviewSessionSnapshot,
  opts: RefineCommandOptions,
  paths: ReviewSessionPaths,
  sessionId: string,
): Promise<void> {
  let result = { ...snapshot };

  const rejectPatterns = [...(opts.reject ?? []), ...(opts.deselect ?? [])].map((p) => p.toLowerCase());
  const selectPatterns = (opts.select ?? []).map((p) => p.toLowerCase());
  const selectAll = opts.acceptAll || opts.selectAll;

  if (selectAll || rejectPatterns.length > 0 || selectPatterns.length > 0) {
    result = {
      ...result,
      components: result.components.map((c) => {
        const nameLower = c.name.toLowerCase();
        if (rejectPatterns.some((p) => nameLower.includes(p))) {
          return { ...c, status: 'rejected' };
        }
        if (selectAll && shouldExcludeDueToValidation(c.originalProposal)) {
          return { ...c, status: 'rejected' };
        }
        if (selectAll || selectPatterns.some((p) => nameLower.includes(p))) {
          return { ...c, status: 'accepted' };
        }
        return c;
      }),
    };
  }

  // Apply --patch
  if (opts.patch) {
    let patchOps: PatchOperation[];
    try {
      const raw = await readFile(resolve(opts.patch), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        process.stderr.write(`Error: --patch file must be a JSON array of patch operations: ${opts.patch}\n`);
        process.exit(1);
        return;
      }
      patchOps = parsed as PatchOperation[];
    } catch {
      process.stderr.write(`Error: cannot read or parse --patch file: ${opts.patch}\n`);
      process.exit(1);
      return;
    }

    // Warn on unknown component names
    const knownNames = new Set(result.components.map((c) => c.name));
    for (const op of patchOps) {
      if (!knownNames.has(op.component)) {
        process.stderr.write(`Warning: --patch targets unknown component '${op.component}', skipping\n`);
      }
    }

    result = applyPatch(result, patchOps);
  }

  const accepted = result.components.filter((c) => c.status === 'accepted');
  const rejected = result.components.filter((c) => c.status === 'rejected');

  if (selectAll) {
    const autoRejected = result.components
      .filter((c) => c.status === 'rejected' && shouldExcludeDueToValidation(c.originalProposal))
      .map((c) => ({ name: c.name, validationIssues: c.originalProposal.validationIssues }));
    process.stderr.write(formatExclusionWarning(autoRejected));
  }

  // Persist decisions to session state so pipeline orchestrator can read them
  await saveReviewState(paths.statePath, result);

  // Sync edited proposals back to the DB so generation uses the user's edits
  if (accepted.length > 0) {
    const db = openPipelineDb();
    try {
      storeRawComponents(
        db,
        sessionId,
        accepted.map((c) => c.editedProposal),
      );
    } finally {
      db.close();
    }
  }

  process.stderr.write(`Accepted: ${accepted.length}  Rejected: ${rejected.length}\n`);
}

/**
 * Load components from the pipeline DB and re-run extraction validation.
 *
 * `validationIssues` is intentionally not persisted (the validator is pure
 * and cheap to re-run), so any cold-start of `analyze select` from a prior
 * `analyze extract` session needs to recompute it before building the
 * review snapshot — otherwise the TUI sees no validation errors at all.
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
 * Split a snapshot into (invalid component names, valid components) using the
 * extraction validator's error severity. Used by --exclude-invalid.
 */
export function partitionForExcludeInvalid(snapshot: ReviewSessionSnapshot): {
  invalidNames: string[];
  validComponents: RawComponentDefinition[];
} {
  const invalidNames: string[] = [];
  const validComponents: RawComponentDefinition[] = [];
  for (const record of snapshot.components) {
    if (shouldExcludeDueToValidation(record.originalProposal)) {
      invalidNames.push(record.name);
    } else {
      validComponents.push(record.originalProposal);
    }
  }
  return { invalidNames, validComponents };
}

/**
 * Apply select-all decisions to a snapshot. Components with error-severity
 * validation issues are always auto-rejected — they cannot silently pass
 * through bulk-approve regardless of flags.
 */
export function applySelectAllDecisions(snapshot: ReviewSessionSnapshot): ReviewSessionSnapshot {
  return {
    ...snapshot,
    components: snapshot.components.map((c) => {
      if (shouldExcludeDueToValidation(c.originalProposal)) {
        return { ...c, status: 'rejected' };
      }
      return { ...c, status: 'accepted' };
    }),
  };
}

/**
 * Synthesize SERVER_VALIDATION_FAILED issues onto the review state file's
 * matching components. Used by the wizard's 422 recovery path: after a
 * preview-API validation error, this runs before re-launching the
 * analyze-select TUI so the Sidebar's existing red-warning rendering
 * pins the offenders to the top.
 *
 * Idempotent on identical input is NOT a contract: each call appends.
 * The wizard's 422 path is a one-shot per preview attempt, so duplicate
 * issues only matter if a caller invokes this twice without the user
 * round-tripping through the TUI in between.
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

function resolveSessionId(sessionFlag: string | undefined): string {
  if (sessionFlag) return sessionFlag;

  const db = openPipelineDb();
  try {
    const row = db
      .prepare(
        `SELECT s.id FROM sessions s
         JOIN steps st ON st.session_id = s.id
         WHERE st.command = 'analyze extract'
           AND st.status = 'complete'
         ORDER BY st.started_at DESC
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;

    if (!row) {
      process.stderr.write(
        'Error: no completed analyze extract session found. Run analyze extract first, or pass --session <id>.\n',
      );
      process.exit(1);
    }
    return row.id;
  } finally {
    db.close();
  }
}

export function registerAnalyzeEditCommand(program: Command): void {
  program
    .command('select')
    .alias('edit')
    .description('Select components for generation and optionally patch their definitions')
    .option('--session <id>', 'Session ID from analyze extract (defaults to most recent)')
    .option('--project-root <path>', 'Project root for resolving component source files')
    .option('--select-all', 'Select all components without launching the TUI')
    .option('--select <pattern>', 'Select components whose name contains pattern (repeatable)', collect, [])
    .option('--deselect <pattern>', 'Deselect components whose name contains pattern (repeatable)', collect, [])
    .option('--accept-all', 'Alias for --select-all', false)
    .option('--reject <pattern>', 'Alias for --deselect <pattern> (repeatable)', collect, [])
    .option('--patch <path>', 'Path to a JSON patch file for structured component overrides')
    .option(
      '--exclude-invalid',
      'No-op — error-severity components are always excluded with --select-all (kept for backward compatibility)',
    )
    .action(
      async ({
        session: sessionFlag,
        projectRoot,
        acceptAll,
        selectAll,
        reject,
        deselect,
        select,
        patch,
        excludeInvalid,
      }: RefineCommandOptions) => {
        const sessionId = resolveSessionId(sessionFlag);

        const db = openPipelineDb();
        let rawComponentCount = 0;
        try {
          rawComponentCount = loadRawComponents(db, sessionId).length;
        } finally {
          db.close();
        }

        if (rawComponentCount === 0) {
          process.stderr.write(`Error: session '${sessionId}' has no raw components. Run analyze extract first.\n`);
          process.exit(1);
          return;
        }

        const artifactsRoot = getRefineArtifactsRoot();

        const nonInteractive =
          acceptAll ||
          selectAll ||
          (reject ?? []).length > 0 ||
          (deselect ?? []).length > 0 ||
          (select ?? []).length > 0 ||
          !!patch;

        let paths: ReviewSessionPaths;
        let snapshot: ReviewSessionSnapshot;
        try {
          snapshot = await loadAndValidateForReview(sessionId, projectRoot);
          paths = await getRefineSessionPaths(sessionId, artifactsRoot);
          if (!nonInteractive) {
            snapshot = await ensureRefineSession(sessionId, artifactsRoot, snapshot);
          } else {
            await ensureRefineSession(sessionId, artifactsRoot, snapshot);
          }
        } catch (error) {
          process.stderr.write(
            `Error: unable to initialize refine session.\n${error instanceof Error ? error.message : String(error)}\n`,
          );
          process.exit(1);
          return;
        }

        // Non-interactive path
        if (nonInteractive) {
          const stepDb = openPipelineDb();
          const stepId = createStep(stepDb, sessionId, 'analyze select', { sessionId });
          try {
            await runNonInteractive(
              snapshot,
              {
                session: sessionFlag,
                projectRoot,
                acceptAll,
                selectAll,
                reject,
                deselect,
                select,
                patch,
                excludeInvalid,
              },
              paths,
              sessionId,
            );
            updateStep(stepDb, stepId, 'complete', { sessionId });
          } catch (err) {
            updateStep(stepDb, stepId, 'failed', {}, err instanceof Error ? err.message : String(err));
            stepDb.close();
            throw err;
          }
          stepDb.close();
          return;
        }

        // Test mode: print launch contract and return without launching TUI
        if (process.env.EDS_REVIEW_TEST_MODE === '1') {
          process.stdout.write(
            `session=${sessionId}\n` +
              `session_dir=${paths.sessionDir}\n` +
              `events.jsonl=${paths.eventsPath}\n` +
              `current-review-state.json=${paths.statePath}\n`,
          );
          return;
        }

        if (!process.stdout.isTTY) {
          process.stderr.write('Error: analyze select requires an interactive terminal\n');
          process.exit(1);
        }

        if (process.stdout.columns !== undefined && process.stdout.columns < 60) {
          process.stderr.write(`Error: terminal too narrow (${process.stdout.columns} cols). Resize to 60+ columns.\n`);
          process.exit(1);
        }

        const { waitUntilExit } = render(
          createElement(App, {
            sessionId,
            artifactsRoot,
            reviewRoot: projectRoot,
          }),
        );

        await waitUntilExit();
      },
    );
}

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}
