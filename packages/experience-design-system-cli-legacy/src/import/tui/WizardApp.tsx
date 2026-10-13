import React, { useEffect, useRef, useState } from 'react';
import { Box } from 'ink';
import { join, resolve } from 'node:path';
import { appendFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { buildRunTeaserLine } from './run-teaser.js';
import { getDebugLogger } from '../../lib/debug-logger.js';
import { PathPrompt } from '../../runs/path-prompt.js';
import { detectSaveConflict, buildTimestampedSubdir } from '../../runs/save-path-resolver.js';
import { appendRun, updateRun } from '../../runs/store.js';
import { buildSourceFingerprint } from '../../runs/fingerprint.js';
import { TopBar } from '../../analyze/select/tui/components/TopBar.js';
import { CustomPromptBanner } from './CustomPromptBanner.js';
import { RunningStep } from './steps/RunningStep.js';
import { GateStep } from './steps/GateStep.js';
import { readHandoff } from './handoff.js';
import { WizardPreviewStep } from './steps/WizardPreviewStep.js';
import { DoneStep } from './steps/DoneStep.js';
import { ErrorStep } from './steps/ErrorStep.js';
import { PreviewValidationErrorStep } from './steps/PreviewValidationErrorStep.js';
import { PushingStep } from './steps/PushingStep.js';
import { type PushProgress } from './push-progress.js';
import { nextStateAfterPrint } from './run-print-files-helpers.js';
import { ImportApiClient, ApiError, type PreviewValidationError } from '../../apply/api-client.js';
import {
  detectSlotCycles,
  extractComponents,
  formatSlotCycleReport,
  formatUnresolvedSlotReferences,
} from '../../apply/command.js';
import { findSlotCycles } from '../../analyze/cycle-detection.js';
import { buildComponentGraph } from '../../analyze/slot-graph.js';
import { formatApiError, formatEdsiError } from '../../lib/error-parser.js';
import { handlePreview422, applySkipValidationErrors, clearedValidationErrorState } from './wizard-422-helpers.js';
import { readTokensFromPath, hasBreakingChangesWithImpact, toCDFTokens } from '../../apply/tokens.js';
import { isEmptyPreview } from '../../apply/preview-utils.js';
import { buildCDF, validateCDF, validateSlotReferences } from '@contentful/experience-design-system-types';
import type {
  ServerPreviewResponse,
  CDFDocument,
  CDFComponentEntry,
  DTCGTokenEntry,
} from '@contentful/experience-design-system-types';
import {
  openPipelineDb,
  loadCDFComponents,
  loadDTCGTokens,
  seedCDFFromPreviewResponse,
  seedDefaultsFromChangedItems,
  backfillUnclassifiedProps,
} from '../../session/db.js';
import { GenerateReviewStep } from './steps/GenerateReviewStep.js';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../../host-utils.js';
import {
  shouldBypassPreview,
  buildSkippedPreviewTransition,
  shouldRefusePush,
  buildSkippedPushTransition,
  resolveCycleGateAction,
} from './wizard-state-transitions.js';
import { useTerminalSize } from '../../tui/use-terminal-size.js';
import { useScreenTransitionClear } from '../../tui/render-with-goodbye.js';

const SAVE_CONFIRMATION_DELAY_MS = 1000;

type WizardStep =
  | 'credential-test-gate'
  | 'validating-credentials'
  | 'final-review'
  | 'credentials'
  | 'previewing'
  | 'preview-gate'
  | 'pushing'
  | 'path-prompt'
  | 'printing'
  | 'print-gate'
  | 'done'
  | 'error'
  | 'preview-validation-error';

type PushResult = {
  componentTypes: {
    created: number;
    updated: number;
    removed: number;
    failed: number;
  };
  designTokens: {
    created: number;
    updated: number;
    removed: number;
    failed: number;
  };
  summary?: { total: number; succeeded: number; failed: number };
  failures?: Array<{ entityType: string; entityId: string; message: string }>;
};

type WizardState = {
  step: WizardStep;
  agent: string;
  agentModel?: string;
  bedrock?: boolean;
  projectPath: string;
  outDir: string;
  rawTokensPath: string;
  tokensPath: string;
  tokenSessionId: string | null;
  tokenGenerationStatus: 'idle' | 'running' | 'complete' | 'failed';
  mapTokensStatus: 'idle' | 'running' | 'complete' | 'failed';
  tokenCount: number;
  extractSessionId: string | null;
  generateSessionId: string | null;
  acceptedCount: number;
  autoRejectedCount: number;
  generatedCount: number;
  generatedAcceptedCount: number;
  generateProgress: { done: number; total: number; current: string } | null;
  selectionAgentStatus: 'idle' | 'running' | 'complete';
  compositionPhase: string | null;
  componentsPath: string;
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host: string;
  credentialsError: string;
  serverPreview: ServerPreviewResponse | null;
  cdf: CDFDocument | null;
  pushProgress: PushProgress;
  pushResult: PushResult;
  errorStep: string;
  errorMessage: string;
  errorAllowCredentialRetry: boolean;
  errorAllowBreakingChangeAcknowledgment: boolean;
  authCheckStepNumber: number;
  previewValidationErrors: PreviewValidationError[];
  previewValidationMissingNames: string[];
  credentialsValidating: boolean;
  credentialsBackgroundValidating: boolean;
  mapTokensEligible: boolean | null;
  credentialsSkipped: boolean;
  /**
   * Absolute path to `<outDir>/.existing-entities.json` if the fetch step
   * fired after credentials validated. Forwarded to each downstream agent
   * subprocess as --existing-entities-path so classifications can align
   * with the target space.
   */
  existingEntitiesPath: string | null;
  existingEntitiesStatus: 'idle' | 'running' | 'complete' | 'failed';
  lastRunId: string | null;
  finalizeErrorBanner: string | null;
  finalReviewPassed: boolean;
};

export function buildSavedCDF(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
  tokens: DTCGTokenEntry[],
  opts: { deleteAll?: boolean } = {},
): CDFDocument {
  const cdf = buildCDF(components, toCDFTokens(tokens), opts);
  if (!cdf) throw new Error('nothing to save — no components or tokens resolved');
  const validation = validateCDF(cdf);
  if (!validation.valid) {
    throw new Error(`generated CDF failed validation: ${validation.errors.map((error) => error.message).join(', ')}`);
  }
  return cdf;
}

export function parsePrintTokensCount(stdout: string): number {
  const m = /\((\d+)\s+token/.exec(stdout);
  return m ? Number(m[1]) : 0;
}

const WIZARD_LOG = join(tmpdir(), 'experiences-import-wizard.log');

function logStep(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  appendFileSync(WIZARD_LOG, line);
  getDebugLogger().event('wizard', 'step', entry);
}

export type WizardAppProps = {
  initialSpaceId?: string;
  initialEnvironmentId?: string;
  initialCmaToken?: string;
  initialHost?: string;
  initialAgent?: string;
  initialModel?: string;
  bedrock?: boolean;
  initialProjectPath?: string;
  host?: string;
  livePreview?: boolean;
  generatePromptPath?: string;
  initialRawTokensPath?: string;
};

export function WizardApp({
  initialSpaceId = '',
  initialEnvironmentId = 'master',
  initialCmaToken = '',
  initialHost,
  initialAgent,
  initialModel,
  bedrock = false,
  initialProjectPath,
  host,
  livePreview = true,
  generatePromptPath,
  initialRawTokensPath,
}: WizardAppProps = {}): React.ReactElement {
  const defaultConfiguredHost = toConfiguredHost(host || process.env['EDS_HOST']) ?? DEFAULT_CONFIGURED_HOST;
  const resolveWizardHost = (hostValue?: string): string => hostValue || defaultConfiguredHost;
  const { columns: terminalWidth } = useTerminalSize();
  const clearScreenOnTransition = useScreenTransitionClear();
  const logInit = useRef(false);
  if (!logInit.current) {
    writeFileSync(WIZARD_LOG, `--- experiences import session ${new Date().toISOString()} ---\n`);
    logInit.current = true;
  }

  const sessionRef = useRef<{
    extractSessionId: string | null;
    tokensPath: string;
  }>({
    extractSessionId: null,
    tokensPath: '',
  });

  // Set at finalize when zero components are accepted (confirmed via the
  // FinalizeDialog warning). Read by preview/push so buildCDF emits an
  // empty-but-present document → server deletes all. A ref (not state) so
  // the async preview/push closures see the confirmed value.
  const allowEmptyDeleteAllRef = useRef(false);

  const credentialsReadyRef = useRef(false);
  const scopeGateCompletedRef = useRef(false);

  const rawTokensEntryReady = !!initialRawTokensPath;
  // The CLI has already done the early stages and tells the wizard what it did. A missing or broken handoff is shown as
  // an error: the wizard can no longer do those stages itself.
  const [startedFrom] = useState(() => readHandoff());
  const initialStepResolved: WizardStep = startedFrom.ok ? 'credentials' : 'error';
  const initialOutDir = initialProjectPath ? join(resolve(initialProjectPath), '.contentful') : '';

  const [state, setState] = useState<WizardState>({
    step: initialStepResolved,
    agent: initialAgent ?? 'claude',
    ...(initialModel ? { agentModel: initialModel } : {}),
    ...(bedrock ? { bedrock: true } : {}),
    projectPath: initialProjectPath ?? '',
    outDir: initialOutDir,
    rawTokensPath: rawTokensEntryReady ? initialRawTokensPath! : '',
    tokensPath: '',
    tokenSessionId: null,
    tokenGenerationStatus: 'idle',
    mapTokensStatus: 'idle',
    tokenCount: 0,
    extractSessionId: null,
    generateSessionId: null,
    acceptedCount: 0,
    autoRejectedCount: 0,
    generatedCount: 0,
    generatedAcceptedCount: 0,
    generateProgress: null,
    selectionAgentStatus: 'idle',
    compositionPhase: null,
    componentsPath: '',
    spaceId: initialSpaceId,
    environmentId: initialEnvironmentId,
    cmaToken: initialCmaToken,
    host: resolveWizardHost(toConfiguredHost(initialHost)),
    credentialsError: '',
    serverPreview: null,
    cdf: null,
    pushProgress: null,
    pushResult: {
      componentTypes: { created: 0, updated: 0, removed: 0, failed: 0 },
      designTokens: { created: 0, updated: 0, removed: 0, failed: 0 },
    },
    errorStep: '',
    errorMessage: '',
    errorAllowCredentialRetry: false,
    errorAllowBreakingChangeAcknowledgment: false,
    authCheckStepNumber: 1,
    previewValidationErrors: [],
    previewValidationMissingNames: [],
    credentialsValidating: false,
    credentialsBackgroundValidating: false,
    mapTokensEligible: null,
    existingEntitiesPath: null,
    existingEntitiesStatus: 'idle',
    lastRunId: null,
    finalizeErrorBanner: null,
    finalReviewPassed: false,
    ...(startedFrom.ok
      ? startedFrom.state
      : {
          credentialsSkipped: false,
          errorStep: 'start import',
          errorMessage: startedFrom.error,
        }),
  });

  useEffect(() => {
    sessionRef.current = {
      extractSessionId: state.extractSessionId,
      tokensPath: state.tokensPath,
    };
  }, [state.extractSessionId, state.tokensPath]);

  const update = (partial: Partial<WizardState>, options: { clearScreen?: boolean } = {}) => {
    if (partial.step !== undefined && partial.step !== state.step && options.clearScreen !== false) {
      clearScreenOnTransition();
    }
    const sanitized = { ...partial };
    if (sanitized.serverPreview) {
      const p = sanitized.serverPreview;
      (sanitized as Record<string, unknown>).serverPreview = {
        components: {
          new: p.components.new.length,
          newNames: p.components.new.map(
            (c) => (c as unknown as Record<string, unknown>).name ?? JSON.stringify(c).slice(0, 80),
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
          name: (t.current as unknown as Record<string, unknown>).name,
          hasPendingDraftChanges: t.hasPendingDraftChanges,
          classification: t.changeClassification?.classification,
          breakingChanges: t.changeClassification?.breakingChanges,
          impact: t.impact,
        })),
        tokenDiffs: p.tokens.changed.slice(0, 3).map((t) => ({
          current: t.current,
          proposed: t.proposed,
        })),
        hasBreakingWithImpact: hasBreakingChangesWithImpact(p),
      };
    }
    if (sanitized.cdf) (sanitized as Record<string, unknown>).cdf = '[cdf]';
    if ((sanitized as Record<string, unknown>).cmaToken) (sanitized as Record<string, unknown>).cmaToken = '[redacted]';
    logStep({ update: sanitized });
    setState((prev) => ({ ...prev, ...partial }));
  };

  const advanceToPushFlow = (generatedAcceptedCount: number) => {
    update({ generatedAcceptedCount });
    void runSaveAndPush();
  };

  const runEditFromPreview = async () => {
    update({ step: 'final-review' });
  };

  const runSkipValidationErrorsAndRetry = async (errors: PreviewValidationError[]) => {
    await applySkipValidationErrors(state.extractSessionId, errors);
    const { extractSessionId: sid, tokensPath: tp } = sessionRef.current;
    void runPreview(sid, tp, state.spaceId, state.environmentId, state.cmaToken, state.host);
  };

  // The CLI has already done everything up to the review: it ran extraction, showed the scope gate, saved the decisions
  // and generated the definitions. All that is left to decide is where the wizard begins.
  const advanceAfterCredentialsValidated = async () => {
    credentialsReadyRef.current = true;
    if (!startedFrom.ok || !startedFrom.route || !sessionRef.current.extractSessionId) {
      update({
        step: 'error',
        errorStep: 'start import',
        errorMessage: 'Internal error: the CLI did not hand over the generated definitions.',
      });
      return;
    }
    scopeGateCompletedRef.current = true;
    if (startedFrom.route === 'push') {
      // Nothing was accepted, so there is nothing to review: go straight on to saving and pushing.
      advanceToPushFlow(0);
      return;
    }
    update({ step: 'final-review' });
  };

  const runPreview = async (
    extractSessionId: string | null,
    tokensPath: string,
    spaceId: string,
    environmentId: string,
    cmaToken: string,
    host: string,
  ) => {
    if (shouldBypassPreview(state)) {
      update(buildSkippedPreviewTransition());
      return;
    }
    update({ step: 'previewing' });
    const resolvedHost = resolveWizardHost(host);
    try {
      const client = new ImportApiClient({
        cmaToken,
        spaceId,
        environmentId,
        host: resolvedHost,
      });

      let components: Array<{
        key: string;
        entry: import('@contentful/experience-design-system-types').CDFComponentEntry;
      }> = [];
      if (extractSessionId) {
        const db = openPipelineDb();
        try {
          backfillUnclassifiedProps(db, extractSessionId);
          components = loadCDFComponents(db, extractSessionId);
        } finally {
          db.close();
        }
      }
      let tokens: import('@contentful/experience-design-system-types').DTCGTokenEntry[] = [];
      if (tokensPath) {
        tokens = await readTokensFromPath('tokens', tokensPath);
      }
      let cdf = buildCDF(components, toCDFTokens(tokens), {
        deleteAll: allowEmptyDeleteAllRef.current,
      })!;
      let preview = await client.previewImport(cdf);

      if (extractSessionId) {
        let needsRepreview = false;
        const db = openPipelineDb();
        try {
          if (preview.components.removed.length > 0) {
            const localNames = new Set(
              (
                db.prepare(`SELECT name FROM raw_components WHERE session_id = ?`).all(extractSessionId) as Array<{
                  name: string;
                }>
              ).map((r) => r.name),
            );
            const falseRemovals = preview.components.removed.filter((r) => localNames.has(r.name));
            if (falseRemovals.length > 0) {
              const seeded = seedCDFFromPreviewResponse(db, extractSessionId, falseRemovals);
              if (seeded > 0) needsRepreview = true;
            }
          }

          if (preview.components.changed.length > 0) {
            const seededDefaults = seedDefaultsFromChangedItems(db, extractSessionId, preview.components.changed);
            if (seededDefaults > 0) needsRepreview = true;
          }

          if (needsRepreview) {
            components = loadCDFComponents(db, extractSessionId);
            cdf = buildCDF(components, toCDFTokens(tokens), {
              deleteAll: allowEmptyDeleteAllRef.current,
            })!;
            preview = await client.previewImport(cdf);
          }
        } finally {
          db.close();
        }
      }

      if (isEmptyPreview(preview)) {
        // No-op push: the accepted set already matches the target space, so
        // there is nothing to create/update/remove. Route to a terminal "done"
        // state rather than bouncing back to final-review — the review screen
        // resets every component to needs-review on remount, which otherwise
        // traps the operator in an accept → empty-preview → reset loop.
        update({
          step: 'done',
          serverPreview: preview,
          pushResult: {
            componentTypes: { created: 0, updated: 0, removed: 0, failed: 0 },
            designTokens: { created: 0, updated: 0, removed: 0, failed: 0 },
          },
          ...clearedValidationErrorState(),
        });
        return;
      }
      update({
        step: 'preview-gate',
        serverPreview: preview,
        cdf,
        finalizeErrorBanner: null,
        ...clearedValidationErrorState(),
      });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401 || e.status === 403) {
          let bodyMsg = '';
          try {
            bodyMsg = (JSON.parse(e.body) as Record<string, unknown>)['message'] as string;
          } catch {
            /* non-JSON */
          }
          if (bodyMsg && /disabled/i.test(bodyMsg)) {
            update({
              step: 'error',
              errorStep: 'apply preview',
              errorMessage: `Preview failed: ${bodyMsg}`,
              errorAllowCredentialRetry: false,
            });
            return;
          }
          update({
            step: 'error',
            errorStep: 'apply preview',
            errorMessage: `${e.message}\n\nRe-run the import and enter credentials again.`,
          });
          return;
        }
        if (e.status === 404) {
          update({
            step: 'error',
            errorStep: 'apply preview',
            errorAllowCredentialRetry: true,
            errorMessage:
              `Not found (404). Check that the space ID, environment ID, and host are correct.\n\n` +
              `  Space:       ${spaceId}\n` +
              `  Environment: ${environmentId}\n` +
              (resolvedHost ? `  Host:        ${resolvedHost}\n` : '') +
              `\nIf using a custom host configuration, make sure the space exists on that host.`,
          });
          return;
        }
        const outcome = await handlePreview422(e, extractSessionId);
        if (outcome.kind === 'validation-error') {
          update({
            step: 'preview-validation-error',
            previewValidationErrors: outcome.errors,
            previewValidationMissingNames: outcome.missingNames,
          });
          return;
        }
        const formatted = formatApiError(e, process.env['EDSI_VERBOSE_ERRORS'] === '1');
        update({
          step: 'error',
          errorStep: 'apply preview',
          errorMessage: formatted,
          errorAllowCredentialRetry: true,
        });
        return;
      }
      const msg = e instanceof Error ? e.message : 'Preview failed';
      update({
        step: 'error',
        errorStep: 'apply preview',
        errorMessage: msg,
        errorAllowCredentialRetry: true,
      });
    }
  };

  const runPush = async (
    cdf: CDFDocument,
    spaceId: string,
    environmentId: string,
    cmaToken: string,
    host: string,
    acknowledgeBreakingChanges: boolean,
    preview?: ServerPreviewResponse | null,
  ) => {
    if (shouldRefusePush(state)) {
      update(buildSkippedPushTransition());
      return;
    }
    if (preview) {
      const hasComponentChanges =
        preview.components.new.length > 0 ||
        preview.components.changed.length > 0 ||
        preview.components.removed.length > 0;
      const hasTokenChanges =
        preview.tokens.new.length > 0 || preview.tokens.changed.length > 0 || preview.tokens.removed.length > 0;
      if (!hasComponentChanges && !hasTokenChanges) {
        update({
          step: 'done',
          pushResult: {
            componentTypes: { created: 0, updated: 0, removed: 0, failed: 0 },
            designTokens: { created: 0, updated: 0, removed: 0, failed: 0 },
          },
        });
        return;
      }
    }

    const cycles = detectSlotCycles(extractComponents(cdf));
    if (cycles.length > 0) {
      update({
        step: 'error',
        errorStep: 'apply',
        errorMessage: formatSlotCycleReport(cycles).join('\n'),
        errorAllowCredentialRetry: false,
      });
      return;
    }

    const unresolvedSlotReferences = validateSlotReferences(extractComponents(cdf));
    if (unresolvedSlotReferences.length > 0) {
      update({
        step: 'error',
        errorStep: 'apply',
        errorMessage: formatUnresolvedSlotReferences(unresolvedSlotReferences).join('\n'),
        errorAllowCredentialRetry: false,
      });
      return;
    }

    update({
      step: 'pushing',
      pushProgress: null,
      errorAllowBreakingChangeAcknowledgment: false,
    });
    try {
      const resolvedHost = resolveWizardHost(host);
      const client = new ImportApiClient({
        cmaToken,
        spaceId,
        environmentId,
        host: resolvedHost,
      });
      let operation = await client.applyImport(cdf, {
        acknowledgeBreakingChanges,
      });
      try {
        logStep({
          applyResponse: {
            status: operation.sys.status,
            id: operation.sys.id,
            keys: Object.keys(operation),
          },
        });
      } catch (err) {
        process.stderr.write(`[eds] log write failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      update({
        pushProgress: { kind: 'queued', operationId: operation.sys.id },
      });

      let pollCount = 0;
      operation = await client.pollOperation(operation.sys.id, {
        onProgress: (op) => {
          pollCount++;
          const s = op.summary;
          if (s) {
            const done = s.total - s.pending;
            const items = op.items ?? [];
            const lastDone = items.length > 0 ? items[items.length - 1] : null;
            const current = lastDone && lastDone.status === 'succeeded' ? lastDone.id : null;
            update({
              pushProgress: {
                kind: 'progress',
                processed: done,
                total: s.total,
                current,
              },
            });
          }
          try {
            logStep({
              pollTick: {
                attempt: pollCount,
                status: op.sys.status,
                summary: op.summary,
              },
            });
          } catch (err) {
            process.stderr.write(`[eds] log write failed: ${err instanceof Error ? err.message : String(err)}\n`);
          }
        },
      });
      try {
        logStep({
          pollResult: {
            status: operation.sys.status,
            keys: Object.keys(operation),
            itemCount: operation.items?.length,
            summary: operation.summary,
            sampleItems: operation.items?.slice(0, 3),
          },
        });
      } catch (logErr) {
        logStep({ pollLogError: String(logErr) });
      }
      const items = operation.items ?? [];
      let pushResult: PushResult;
      if (items.length > 0) {
        pushResult = {
          componentTypes: {
            created: items.filter(
              (i) => i.entityType === 'ComponentType' && i.action === 'create' && i.status === 'succeeded',
            ).length,
            updated: items.filter(
              (i) => i.entityType === 'ComponentType' && i.action === 'update' && i.status === 'succeeded',
            ).length,
            removed: items.filter(
              (i) => i.entityType === 'ComponentType' && i.action === 'delete' && i.status === 'succeeded',
            ).length,
            failed: items.filter((i) => i.entityType === 'ComponentType' && i.status === 'failed').length,
          },
          designTokens: {
            created: items.filter(
              (i) => i.entityType === 'DesignToken' && i.action === 'create' && i.status === 'succeeded',
            ).length,
            updated: items.filter(
              (i) => i.entityType === 'DesignToken' && i.action === 'update' && i.status === 'succeeded',
            ).length,
            removed: items.filter(
              (i) => i.entityType === 'DesignToken' && i.action === 'delete' && i.status === 'succeeded',
            ).length,
            failed: items.filter((i) => i.entityType === 'DesignToken' && i.status === 'failed').length,
          },
          summary: operation.summary,
          failures: items
            .filter((item) => item.status === 'failed')
            .map((item) => ({
              entityType: item.entityType,
              entityId: item.id,
              message: formatEdsiError(item.error),
            })),
        };
      } else {
        const summary = operation.summary;
        const anyFailure =
          summary.failed > 0 || operation.sys.status === 'failed' || operation.sys.status === 'partial';
        pushResult = {
          componentTypes: {
            created: anyFailure ? 0 : (preview?.components.new.length ?? 0),
            updated: anyFailure ? 0 : (preview?.components.changed.length ?? 0),
            removed: anyFailure ? 0 : (preview?.components.removed.length ?? 0),
            failed: summary.failed,
          },
          designTokens: {
            created: anyFailure ? 0 : (preview?.tokens.new.length ?? 0),
            updated: anyFailure ? 0 : (preview?.tokens.changed.length ?? 0),
            removed: anyFailure ? 0 : (preview?.tokens.removed.length ?? 0),
            failed: 0,
          },
          summary,
        };
      }
      const pushSucceeded =
        pushResult.componentTypes.failed === 0 &&
        pushResult.designTokens.failed === 0 &&
        operation.sys.status !== 'failed';
      if (pushSucceeded && state.lastRunId) {
        try {
          await updateRun(state.lastRunId, {
            pushedTo: { spaceId, environmentId, host: resolvedHost },
          });
        } catch (err) {
          process.stderr.write(
            `Warning: failed to record push target on run: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
      update({ step: 'done', pushResult });
    } catch (e) {
      let msg: string;
      if (e instanceof ApiError) {
        msg = formatApiError(e, process.env['EDSI_VERBOSE_ERRORS'] === '1');
      } else if (e instanceof Error) {
        msg = e.message;
      } else {
        msg = 'Push failed';
      }
      update({
        step: 'error',
        errorStep: 'apply',
        errorMessage: msg,
        errorAllowCredentialRetry: !(
          e instanceof ApiError &&
          e.status === 422 &&
          /acknowledgeBreakingChanges/i.test(e.body || e.message)
        ),
        errorAllowBreakingChangeAcknowledgment:
          e instanceof ApiError && e.status === 422 && /acknowledgeBreakingChanges/i.test(e.body || e.message),
      });
    }
  };

  const runPrintFiles = async (
    extractSessionId: string | null,
    outDir: string,
    opts: {
      skipGate?: boolean;
      tokenSessionId?: string | null;
      tokensPath?: string;
      allowEmpty?: boolean;
    } = {},
  ): Promise<{ ok: boolean }> => {
    update({ step: 'printing' });
    const componentsPath = join(outDir, 'components.json');
    try {
      const db = openPipelineDb();
      let components: ReturnType<typeof loadCDFComponents> = [];
      let tokens: DTCGTokenEntry[] = [];
      try {
        if (extractSessionId) components = loadCDFComponents(db, extractSessionId);
        if (opts.tokenSessionId) tokens = loadDTCGTokens(db, opts.tokenSessionId).tokens;
      } finally {
        db.close();
      }
      if (!opts.tokenSessionId && opts.tokensPath) tokens = await readTokensFromPath('tokens', opts.tokensPath);

      const cdf = buildSavedCDF(components, tokens, {
        deleteAll: opts.allowEmpty,
      });
      await writeFile(componentsPath, `${JSON.stringify(cdf, null, 2)}\n`);
      process.stderr.write(
        `wrote ${componentsPath} (${components.length} component${components.length === 1 ? '' : 's'}, ${tokens.length} token${tokens.length === 1 ? '' : 's'})\n`,
      );
    } catch (error) {
      update({
        step: 'error',
        errorStep: 'save CDF',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      return { ok: false };
    }
    // Keep the successful write confirmation visible long enough to read
    // before the save-and-push flow advances to preview.
    await new Promise<void>((resolve) => setTimeout(resolve, SAVE_CONFIRMATION_DELAY_MS));
    update(nextStateAfterPrint({ skipGate: opts.skipGate, componentsPath }));
    return { ok: true };
  };

  const runSaveAndPush = async (statePatch: Partial<WizardState> = {}): Promise<void> => {
    await startSaveFlow({ skipGate: true, andPush: true }, statePatch);
  };

  const pendingSaveOptionsRef = useRef<{
    skipGate?: boolean;
    andPush?: boolean;
  }>({});

  const startSaveFlow = async (
    opts: { skipGate?: boolean; andPush?: boolean } = {},
    statePatch: Partial<WizardState> = {},
  ): Promise<void> => {
    pendingSaveOptionsRef.current = opts;
    update({ ...statePatch, step: 'path-prompt' });
  };

  const proceedToWrite = async (path: string): Promise<void> => {
    setState((prev) => ({ ...prev, outDir: path }));
    const { extractSessionId, tokensPath } = sessionRef.current;
    const { skipGate, andPush } = pendingSaveOptionsRef.current;
    const result = await runPrintFiles(extractSessionId, path, {
      ...(skipGate ? { skipGate: true } : {}),
      ...(state.tokenSessionId ? { tokenSessionId: state.tokenSessionId } : {}),
      ...(tokensPath ? { tokensPath } : {}),
      ...(allowEmptyDeleteAllRef.current ? { allowEmpty: true } : {}),
    });
    if (!result.ok) return;
    const recordedTokensPath = state.tokenSessionId ? tokensPath || null : null;
    const recordedTokenCount = state.tokenCount;
    if (result.ok) {
      try {
        let sourceFingerprint: Awaited<ReturnType<typeof buildSourceFingerprint>> | null = null;
        try {
          if (state.extractSessionId) {
            const db = openPipelineDb();
            try {
              sourceFingerprint = await buildSourceFingerprint({
                db,
                extractSessionId: state.extractSessionId,
                rawTokensPath: state.rawTokensPath || null,
              });
            } finally {
              db.close();
            }
          }
        } catch (err) {
          process.stderr.write(
            `Warning: failed to compute source fingerprint: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
        const record = await appendRun({
          projectPath: state.projectPath,
          savePath: path,
          componentCount: state.generatedAcceptedCount || state.generatedCount,
          tokenCount: recordedTokenCount,
          tokensPath: recordedTokensPath || null,
          tokenSessionId: state.tokenSessionId,
          agent: state.agent,
          pushedTo: null,
          extractSessionId: state.extractSessionId ?? '',
          generateSessionId: state.generateSessionId,
          sourceFingerprint,
        });
        setState((prev) => ({ ...prev, lastRunId: record.id }));
      } catch (err) {
        process.stderr.write(`Warning: failed to record run: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
    if (andPush) {
      void runPreview(extractSessionId, tokensPath, state.spaceId, state.environmentId, state.cmaToken, state.host);
    }
  };

  const credentialsHandedOff = useRef(false);
  useEffect(() => {
    if (state.step !== 'credentials' || credentialsHandedOff.current) return;
    credentialsHandedOff.current = true;
    void advanceAfterCredentialsValidated();
  }, [state.step]);

  const noQuitSteps: WizardStep[] = ['validating-credentials', 'printing', 'previewing', 'pushing'];
  const hints = noQuitSteps.includes(state.step) ? [] : [{ key: 'q', label: 'quit' }];

  const hasTokens = !!state.tokensPath;
  const hasTokenStage = hasTokens || !!state.rawTokensPath;
  const totalSteps = 3 + (hasTokenStage ? 1 : 0) + 2 + (state.mapTokensEligible === true ? 1 : 0);

  const stepContent = (() => {
    switch (state.step) {
      case 'final-review': {
        return (
          <GenerateReviewStep
            extractSessionId={state.extractSessionId}
            tokenSessionId={state.tokenSessionId}
            livePreview={livePreview}
            spaceId={state.spaceId}
            environmentId={state.environmentId}
            cmaToken={state.cmaToken}
            host={state.host}
            tokensPath={state.tokensPath}
            initialFinalizeError={state.finalizeErrorBanner}
            onFinalize={(accepted, rejected, unresolved) => {
              process.stderr.write(`Accepted: ${accepted}  Rejected: ${rejected}  Unresolved: ${unresolved}\n`);
              const acceptedCount = accepted;
              const detectAcceptedCycles = (): ReturnType<typeof findSlotCycles> => {
                if (!state.extractSessionId) return [];
                try {
                  const db = openPipelineDb();
                  try {
                    const acceptedComponents = loadCDFComponents(db, state.extractSessionId);
                    return findSlotCycles(buildComponentGraph(acceptedComponents));
                  } finally {
                    db.close();
                  }
                } catch {
                  return [];
                }
              };
              const acceptedCycles = detectAcceptedCycles();
              const gateAction = resolveCycleGateAction({
                hasCycles: acceptedCycles.length > 0,
              });
              const routeToCycleError = (): void => {
                update({
                  step: 'error',
                  errorStep: 'final review',
                  errorMessage: formatSlotCycleReport(acceptedCycles).join('\n'),
                  errorAllowCredentialRetry: false,
                });
              };
              if (gateAction === 'block') {
                routeToCycleError();
                return;
              }
              const allowEmptyDeleteAll = acceptedCount === 0;
              allowEmptyDeleteAllRef.current = allowEmptyDeleteAll;
              void runSaveAndPush({
                finalReviewPassed: true,
                generatedAcceptedCount: acceptedCount,
              });
            }}
            onQuit={() => process.exit(0)}
          />
        );
      }

      case 'credentials':
        return (
          <RunningStep
            stepNumber={1}
            totalSteps={totalSteps}
            title="Starting import"
            description="Using the credentials you just confirmed..."
          />
        );

      case 'previewing':
        return (
          <RunningStep
            stepNumber={totalSteps}
            totalSteps={totalSteps}
            title="Computing diff"
            description="Computing diff against your Contentful space..."
          />
        );

      case 'preview-gate': {
        // Only offer "[e] Edit definitions" when the CDF document actually
        // has components to edit. In the delete-all / empty case it's
        // present-but-empty (only $schema), so editing would dead-end on the
        // "No generated definitions found" screen.
        const editableComponentCount = extractComponents(state.cdf).length;
        return (
          <WizardPreviewStep
            preview={state.serverPreview!}
            spaceId={state.spaceId}
            environmentId={state.environmentId}
            stepNumber={totalSteps}
            totalSteps={totalSteps}
            onConfirm={(acknowledge) => {
              void runPush(
                state.cdf!,
                state.spaceId,
                state.environmentId,
                state.cmaToken,
                state.host,
                acknowledge,
                state.serverPreview,
              );
            }}
            {...(editableComponentCount > 0 ? { onEdit: () => void runEditFromPreview() } : {})}
            onQuit={() => process.exit(0)}
          />
        );
      }

      case 'pushing':
        return <PushingStep stepNumber={totalSteps} totalSteps={totalSteps} progress={state.pushProgress} />;

      case 'path-prompt':
        return (
          <PathPrompt
            defaultPath={state.outDir}
            onSubmit={(submitted) => {
              void (async () => {
                await mkdir(submitted, { recursive: true });
                const hasConflict = await detectSaveConflict(submitted);
                if (hasConflict) {
                  const subdir = buildTimestampedSubdir(submitted);
                  await mkdir(subdir, { recursive: true });
                  await proceedToWrite(subdir);
                  return;
                }
                await proceedToWrite(submitted);
              })();
            }}
            onCancel={() => process.exit(0)}
          />
        );

      case 'printing':
        return (
          <RunningStep
            stepNumber={totalSteps}
            totalSteps={totalSteps}
            title="Writing files"
            description="Writing output files to disk..."
          />
        );

      case 'print-gate': {
        const teaser = buildRunTeaserLine(state.lastRunId);
        return (
          <GateStep
            successMessage="Files saved"
            summary={[state.componentsPath ? `components.json → ${state.componentsPath}` : null]
              .filter(Boolean)
              .join('\n')}
            context={
              teaser
                ? `Your files are saved to disk. ${teaser}`
                : "Your files are saved to disk. Run `experiences import` again when you're ready to push to Contentful."
            }
            continueLabel="Exit"
            showSkip={false}
            onContinue={() => process.exit(0)}
            onQuit={() => process.exit(0)}
          />
        );
      }

      case 'done': {
        const totalFailed = state.pushResult.componentTypes.failed + state.pushResult.designTokens.failed;
        return (
          <DoneStep
            componentTypes={state.pushResult.componentTypes}
            designTokens={state.pushResult.designTokens}
            summary={state.pushResult.summary}
            failures={state.pushResult.failures}
            spaceId={state.spaceId}
            environmentId={state.environmentId}
            host={state.host}
            onExit={() => process.exit(totalFailed > 0 ? 1 : 0)}
          />
        );
      }

      case 'preview-validation-error': {
        return (
          <PreviewValidationErrorStep
            errors={state.previewValidationErrors}
            missingNames={state.previewValidationMissingNames}
            onEdit={() => {
              void runEditFromPreview();
            }}
            onSkip={() => {
              void runSkipValidationErrorsAndRetry(state.previewValidationErrors);
            }}
            onQuit={() => process.exit(0)}
          />
        );
      }

      case 'error':
        return (
          <ErrorStep
            stepName={state.errorStep}
            message={state.errorMessage}
            onExit={() => process.exit(1)}
            onAcknowledgeBreakingChanges={
              state.errorAllowBreakingChangeAcknowledgment && state.cdf
                ? () =>
                    void runPush(
                      state.cdf!,
                      state.spaceId,
                      state.environmentId,
                      state.cmaToken,
                      state.host,
                      true,
                      state.serverPreview,
                    )
                : undefined
            }
          />
        );

      default:
        return null;
    }
  })();

  return (
    <Box flexDirection="column" width={terminalWidth}>
      <TopBar subcommand="import" hints={hints} />
      <CustomPromptBanner generatePromptPath={generatePromptPath} />
      {stepContent}
    </Box>
  );
}
