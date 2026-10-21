import { appendFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildTimestampedSubdir,
  detectSaveConflict,
  formatSlotCycleReport,
  hasBreakingChangesWithImpact,
  loadSelectedCDFComponents,
  openPipelineDb,
  rejectComponentsByName,
  type PreviewValidationError,
} from '@contentful/experience-design-system-backend-pipeline';
import type { ImportHandoff } from '@contentful/experience-design-system-types/handoff';
import { buildComponentGraph } from '../../07-scope-gate/graph/slot-graph.js';
import { findSlotCycles } from '../../07-scope-gate/graph/cycle-detection.js';
import { resolveCycleGateAction } from '../support/wizard-state-transitions.js';
import { realPreviewDeps, runPreview, type PreviewDeps } from './preview.js';
import { realPushDeps, runPush, type PushDeps } from './push.js';
import { realSaveDeps, recordRun, runPrintFiles, type SaveDeps } from './save.js';
import { EMPTY_PUSH_RESULT, type FlowPatch, type FlowState } from './types.js';

const WIZARD_LOG = join(tmpdir(), 'experiences-import-wizard.log');

/** What the flow starts from: what the earlier stages produced, and the user's saved settings. */
export interface FlowStart {
  handoff: ImportHandoff;
  agent: string;
  projectPath: string;
  /** Where the files are saved by default. */
  outDir: string;
  rawTokensPath: string;
  credentials: { spaceId: string; environmentId: string; cmaToken: string; host: string };
  /** A custom prompt for `generate components`, shown as a warning above every step. */
  generatePromptPath?: string;
}

/** The outside world the flow talks to besides the preview, push and save steps. */
export interface FlowDeps {
  preview: PreviewDeps;
  push: PushDeps;
  save: SaveDeps;
  /** Reads the accepted components, for the cycle check at finalize. */
  loadAcceptedComponents: (sessionId: string) => Array<{ key: string; entry: unknown }>;
  mkdir: (path: string) => Promise<void>;
  detectSaveConflict: (path: string) => Promise<boolean>;
  buildTimestampedSubdir: (path: string) => string;
  rejectComponentsByName: (sessionId: string, names: string[]) => Promise<unknown>;
  /** Writes one line of the wizard's step log. */
  log: (entry: Record<string, unknown>) => void;
  stderr: (text: string) => void;
  /**
   * Called when the step is about to change, before anything is told about the new one. The host clears the terminal
   * here so the next screen is drawn on a clean one. It has to be before: Ink paints as soon as it is told, and a clear
   * after the paint wipes a static screen like the done step, which nothing draws again.
   */
  beforeStepChange?: () => void;
}

function appendWizardLog(entry: Record<string, unknown>): void {
  appendFileSync(WIZARD_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

export function startWizardLog(): void {
  writeFileSync(WIZARD_LOG, `--- experiences import session ${new Date().toISOString()} ---\n`);
}

export function realFlowDeps(): FlowDeps {
  const log = (entry: Record<string, unknown>): void => appendWizardLog(entry);
  return {
    preview: realPreviewDeps(),
    push: realPushDeps(log),
    save: realSaveDeps(),
    loadAcceptedComponents: (sessionId) => {
      const db = openPipelineDb();
      try {
        return loadSelectedCDFComponents(db, sessionId, undefined, undefined, 'definition');
      } finally {
        db.close();
      }
    },
    mkdir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    detectSaveConflict,
    buildTimestampedSubdir,
    rejectComponentsByName,
    log,
    stderr: (text) => process.stderr.write(text),
  };
}

/** The state the flow begins in, from what the earlier stages handed over. */
function initialFlowState(start: FlowStart): FlowState {
  const { handoff } = start;
  const { extraction, generation } = handoff;
  return {
    // replaced by where the flow really begins as soon as the controller is created
    step: 'final-review',
    agent: start.agent,
    projectPath: start.projectPath,
    outDir: extraction?.outDir ?? start.outDir,
    rawTokensPath: start.rawTokensPath,
    tokensPath: extraction?.tokensPath ?? '',
    tokenSessionId: extraction?.tokenSessionId ?? null,
    tokenCount: extraction?.tokenCount ?? 0,
    extractSessionId: extraction?.sessionId ?? null,
    generateSessionId: generation?.route === 'review' ? generation.sessionId : null,
    generatedCount: generation?.route === 'review' ? generation.generatedCount : 0,
    generatedAcceptedCount: 0,
    componentsPath: '',
    spaceId: start.credentials.spaceId,
    environmentId: start.credentials.environmentId,
    cmaToken: start.credentials.cmaToken,
    host: start.credentials.host,
    serverPreview: null,
    cdf: null,
    pushProgress: null,
    pushResult: EMPTY_PUSH_RESULT,
    errorStep: '',
    errorMessage: '',
    errorAllowCredentialRetry: false,
    errorAllowBreakingChangeAcknowledgment: false,
    previewValidationErrors: [],
    previewValidationMissingNames: [],
    mapTokensEligible: generation?.route === 'review' ? generation.mapTokensEligible : null,
    credentialsSkipped: handoff.credentialsSkipped,
    lastRunId: null,
    finalizeErrorBanner: null,
    finalReviewPassed: false,
  };
}

/** What the log gets: the state change without the token, the document, or the whole of a large server response. */
function sanitizeForLog(partial: FlowPatch): Record<string, unknown> {
  const sanitized: Record<string, unknown> = { ...partial };
  const p = partial.serverPreview;
  if (p) {
    sanitized['serverPreview'] = {
      components: {
        new: p.components.new.length,
        newNames: p.components.new.map(
          (c) => (c as unknown as Record<string, unknown>)['name'] ?? JSON.stringify(c).slice(0, 80),
        ),
        changed: p.components.changed.length,
        removed: p.components.removed.length,
        removedNames: p.components.removed.map((c) => c.name),
        unchanged: p.components.unchanged.length,
      },
      tokens: {
        new: p.tokens.new.length,
        changed: p.tokens.changed.length,
        removed: p.tokens.removed.length,
        unchanged: p.tokens.unchanged.length,
      },
      changedComponentDetails: p.components.changed.map((c) => ({
        name: c.current.name,
        hasPendingDraftChanges: c.hasPendingDraftChanges,
        classification: c.changeClassification?.classification,
        breakingChanges: c.changeClassification?.breakingChanges,
        impact: c.impact,
      })),
      changedTokenDetails: p.tokens.changed.slice(0, 5).map((t) => ({
        name: (t.current as unknown as Record<string, unknown>)['name'],
        hasPendingDraftChanges: t.hasPendingDraftChanges,
        classification: t.changeClassification?.classification,
        breakingChanges: t.changeClassification?.breakingChanges,
        impact: t.impact,
      })),
      tokenDiffs: p.tokens.changed.slice(0, 3).map((t) => ({ current: t.current, proposed: t.proposed })),
      hasBreakingWithImpact: hasBreakingChangesWithImpact(p),
    };
  }
  if (partial.cdf) sanitized['cdf'] = '[cdf]';
  if (partial.cmaToken) sanitized['cmaToken'] = '[redacted]';
  return sanitized;
}

/** The names of the components the errors are about, once each. */
function namesToSkip(errors: readonly PreviewValidationError[]): string[] {
  return [...new Set(errors.map((e) => e.componentName))];
}

export interface FlowController {
  getState(): FlowState;
  subscribe(listener: () => void): () => void;
  finalize(accepted: number, rejected: number, unresolved: number): void;
  submitPath(path: string): Promise<void>;
  confirmPreview(acknowledgeBreakingChanges: boolean): void;
  acknowledgeBreakingChanges(): void;
  editDefinitions(): void;
  skipValidationErrors(): Promise<void>;
}

/**
 * The wizard's state machine, taken out of the screen so each transition can be tested without a terminal. It holds the
 * state, applies the patches the steps return, and decides what runs next. It never exits the process: leaving is the
 * screen's decision.
 */
export function createFlowController(start: FlowStart, deps: FlowDeps): FlowController {
  let state: FlowState = initialFlowState(start);
  const listeners = new Set<() => void>();
  // Read by the preview and push, which run after the state they were started from has moved on.
  let allowEmptyDeleteAll = false;
  let pendingSave: { skipGate?: boolean; andPush?: boolean } = {};

  const update = (patch: FlowPatch): void => {
    try {
      deps.log({ update: sanitizeForLog(patch) });
    } catch {
      // A step log that cannot be written must never stop the import.
    }
    if (patch.step !== undefined && patch.step !== state.step) {
      try {
        deps.beforeStepChange?.();
      } catch {
        // A terminal that cannot be cleared must never stop the import.
      }
    }
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const preview = async (): Promise<void> => {
    if (!state.credentialsSkipped) update({ step: 'previewing' });
    update(
      await runPreview(
        {
          state,
          extractSessionId: state.extractSessionId,
          tokensPath: state.tokensPath,
          spaceId: state.spaceId,
          environmentId: state.environmentId,
          cmaToken: state.cmaToken,
          host: state.host,
          deleteAll: allowEmptyDeleteAll,
        },
        deps.preview,
      ),
    );
  };

  const push = async (acknowledgeBreakingChanges: boolean): Promise<void> => {
    if (
      !state.cdf ||
      !(state.step === 'preview-gate' || (state.step === 'error' && state.errorAllowBreakingChangeAcknowledgment))
    )
      return;
    update(
      await runPush(
        {
          state,
          cdf: state.cdf,
          extractSessionId: state.extractSessionId,
          spaceId: state.spaceId,
          environmentId: state.environmentId,
          cmaToken: state.cmaToken,
          host: state.host,
          acknowledgeBreakingChanges,
          preview: state.serverPreview,
        },
        deps.push,
        update,
      ),
    );
  };

  const startSave = (opts: { skipGate?: boolean; andPush?: boolean }, patch: FlowPatch = {}): void => {
    pendingSave = opts;
    update({ ...patch, step: 'path-prompt' });
  };

  const proceedToWrite = async (path: string): Promise<void> => {
    update({ outDir: path });
    const { skipGate, andPush } = pendingSave;
    const written = await runPrintFiles(
      {
        extractSessionId: state.extractSessionId,
        outDir: path,
        ...(skipGate ? { skipGate: true } : {}),
        ...(state.tokenSessionId ? { tokenSessionId: state.tokenSessionId } : {}),
        ...(state.tokensPath ? { tokensPath: state.tokensPath } : {}),
        ...(allowEmptyDeleteAll ? { allowEmpty: true } : {}),
      },
      deps.save,
      update,
    );
    update(written.patch);
    if (!written.ok) return;
    const runId = await recordRun({ state, savePath: path }, deps.save);
    if (runId) update({ lastRunId: runId });
    if (andPush) await preview();
  };

  const detectAcceptedCycles = (): ReturnType<typeof findSlotCycles> => {
    if (!state.extractSessionId) return [];
    const accepted = deps.loadAcceptedComponents(state.extractSessionId);
    return findSlotCycles(buildComponentGraph(accepted as Parameters<typeof buildComponentGraph>[0]));
  };

  // Begins the flow where the generation stage left off: the review, or straight on to saving and pushing.
  const begin = (): void => {
    if (!state.extractSessionId || !start.handoff.generation) {
      update({
        step: 'error',
        errorStep: 'start import',
        errorMessage: 'Internal error: the CLI did not hand over the generated definitions.',
      });
      return;
    }
    if (start.handoff.generation.route === 'push') {
      // Nothing was accepted, so there is nothing to review: go straight on to saving and pushing.
      update({ generatedAcceptedCount: 0 });
      startSave({ skipGate: true, andPush: true });
      return;
    }
    update({ step: 'final-review' });
  };

  begin();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    finalize(accepted, rejected, unresolved) {
      deps.stderr(`Accepted: ${accepted}  Rejected: ${rejected}  Unresolved: ${unresolved}\n`);
      let cycles: ReturnType<typeof findSlotCycles>;
      try {
        cycles = detectAcceptedCycles();
      } catch (error) {
        update({
          step: 'error',
          finalReviewPassed: false,
          errorStep: 'final review',
          errorMessage: `Cannot verify accepted component cycles: ${String(error)}. Return to review and retry before saving.`,
          errorAllowCredentialRetry: false,
        });
        return;
      }
      if (resolveCycleGateAction({ hasCycles: cycles.length > 0 }) === 'block') {
        update({
          step: 'error',
          errorStep: 'final review',
          finalReviewPassed: false,
          errorMessage: formatSlotCycleReport({ cycles }).join('\n'),
          errorAllowCredentialRetry: false,
        });
        return;
      }
      allowEmptyDeleteAll = accepted === 0;
      startSave({ skipGate: true, andPush: true }, { finalReviewPassed: true, generatedAcceptedCount: accepted });
    },

    async submitPath(submitted) {
      if (state.step !== 'path-prompt') return;
      await deps.mkdir(submitted);
      // This run's own folder already holds its tokens.json, so only a folder the user picked can conflict.
      if (resolve(submitted) !== resolve(state.outDir) && (await deps.detectSaveConflict(submitted))) {
        const subdir = deps.buildTimestampedSubdir(submitted);
        await deps.mkdir(subdir);
        await proceedToWrite(subdir);
        return;
      }
      await proceedToWrite(submitted);
    },

    confirmPreview: (acknowledge) => void push(acknowledge),
    acknowledgeBreakingChanges: () => void push(true),
    editDefinitions: () => update({ step: 'final-review', finalReviewPassed: false }),

    async skipValidationErrors() {
      if (state.step !== 'preview-validation-error') return;
      if (state.extractSessionId) {
        const names = namesToSkip(state.previewValidationErrors);
        if (names.length > 0) await deps.rejectComponentsByName(state.extractSessionId, names);
      }
      await preview();
    },
  };
}
