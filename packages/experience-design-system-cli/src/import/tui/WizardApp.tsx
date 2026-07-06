import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { join, resolve } from 'node:path';
import { appendFileSync, writeFileSync } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { buildRunTeaserLine } from './run-teaser.js';
import { getDebugLogger } from '../../lib/debug-logger.js';
import { PathPrompt } from '../../runs/path-prompt.js';
import { RunPicker, type RunPickerSelection } from '../../runs/run-picker.js';
import type { RunRecord } from '../../runs/store.js';
import { SaveConflictGate } from '../../runs/save-conflict.js';
import {
  detectSaveConflict,
  buildTimestampedSubdir,
  resolveSavePath,
  type OnConflictMode,
} from '../../runs/save-path-resolver.js';
import { appendRun } from '../../runs/store.js';
import { buildSourceFingerprint, buildSavedFingerprint } from '../../runs/fingerprint.js';
import { TopBar } from '../../analyze/select/tui/components/TopBar.js';
import { CustomPromptBanner } from './CustomPromptBanner.js';
import { WelcomeStep } from './steps/WelcomeStep.js';
import { PathValidationStep } from './steps/PathValidationStep.js';
import { RunningStep } from './steps/RunningStep.js';
import { GateStep } from './steps/GateStep.js';
import { CredentialsStep } from './steps/CredentialsStep.js';
import { WizardPreviewStep } from './steps/WizardPreviewStep.js';
import { DoneStep } from './steps/DoneStep.js';
import { ErrorStep } from './steps/ErrorStep.js';
import { TokenInputStep } from './steps/TokenInputStep.js';
import { PreviewValidationErrorStep } from './steps/PreviewValidationErrorStep.js';
import { PushingStep } from './steps/PushingStep.js';
import { type PushProgress } from './push-progress.js';
import { nextStateAfterPrint } from './run-print-files-helpers.js';
import { PushDecisionGateStep } from './steps/PushDecisionGateStep.js';
import { chooseGateAction } from './push-decision-gate-helpers.js';
import { ImportApiClient, ApiError, type PreviewValidationError } from '../../apply/api-client.js';
import { handlePreview422, applySkipValidationErrors, clearedValidationErrorState } from './wizard-422-helpers.js';
import { parseGenerateStderrChunk, type GenerateProgressState } from './wizard-generate-progress.js';
import { spawnGenerateChild } from './spawn-generate.js';
import { readTokensFromPath, hasBreakingChangesWithImpact } from '../../apply/manifest.js';
import { isEmptyPreview } from '../../apply/preview-utils.js';
import { buildManifest } from '@contentful/experience-design-system-types';
import type { ServerPreviewResponse, ManifestPayload } from '@contentful/experience-design-system-types';
import {
  openPipelineDb,
  loadCDFComponents,
  loadScopeComponents,
  seedCDFFromPreviewResponse,
  seedDefaultsFromChangedItems,
  backfillUnclassifiedProps,
} from '../../session/db.js';
import { ScopeGateHost, type ScopeComponent } from './scope-gate-host.js';
import { mergeAiDecisions } from './merge-ai-decisions.js';
import { FinalReviewHost } from './final-review-host.js';
import { runScopeGate } from './runScopeGate.js';
import { buildAutoFilterErrorTail } from './auto-filter-error.js';
import { checkAgentAuth, type AgentName } from '../../generate/agent-runner.js';
import { normalizePath } from '../path-utils.js';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../../host-utils.js';
import { writeExperiencesCredentials } from '../../credentials-store.js';
import {
  nextStepAfterScopeGate,
  nextStepAfterCredentialsValidated,
  shouldBypassPreview,
  buildSkippedPreviewTransition,
  shouldRefusePush,
  buildSkippedPushTransition,
} from './wizard-state-transitions.js';

type WizardStep =
  | 'run-picker'
  | 'welcome'
  | 'token-input'
  | 'token-reuse-gate'
  | 'checking-claude-auth'
  | 'credential-test-gate'
  | 'validating-credentials'
  | 'generating-tokens'
  | 'path-validation'
  | 'extracting'
  | 'scope-gate'
  | 'generating'
  | 'final-review'
  | 'push-decision-gate'
  | 'credentials'
  | 'push-from-picker'
  | 'previewing'
  | 'preview-gate'
  | 'pushing'
  | 'path-prompt'
  | 'save-conflict-gate'
  | 'printing'
  | 'print-gate'
  | 'done'
  | 'error'
  | 'preview-validation-error';

type PushResult = {
  componentTypes: { created: number; updated: number; removed: number; failed: number };
  designTokens: { created: number; updated: number; removed: number; failed: number };
  summary?: { total: number; succeeded: number; failed: number };
};

type WizardState = {
  step: WizardStep;
  agent: string;
  /**
   * Parity-audit Q4: resolved LLM model override forwarded to spawned
   * `analyze select-agent` and `generate components` subprocesses. Resolution
   * chain: `--model` flag > `credentials.json#agentModel` > undefined (each
   * agent runner picks its own fast default).
   */
  agentModel?: string;
  projectPath: string;
  outDir: string;
  rawTokensPath: string;
  tokensPath: string;
  tokenSourceChanged: boolean | null;
  skipComponents: boolean;
  tokenSessionId: string | null;
  /** Number of tokens in the most recent `print tokens` invocation. Parsed
   *  from the `wrote tokens.json (N tokens)` confirmation line. Used to
   *  populate the `tokenCount` field on the run record. */
  tokenCount: number;
  extractSessionId: string | null;
  generateSessionId: string | null;
  extractedCount: number;
  acceptedCount: number;
  autoRejectedCount: number;
  generatedCount: number;
  generatedAcceptedCount: number;
  renamedSlotsCount: number;
  generateProgress: { done: number; total: number; current: string } | null;
  extractProgress: {
    scanned: number;
    filesProcessed: number;
    totalFiles: number;
    componentsFound: number;
  } | null;
  componentsPath: string;
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host: string;
  credentialsError: string;
  serverPreview: ServerPreviewResponse | null;
  manifest: ManifestPayload | null;
  pushProgress: PushProgress;
  pushResult: PushResult;
  errorStep: string;
  errorMessage: string;
  errorAllowCredentialRetry: boolean;
  authCheckStepNumber: number;
  previewValidationErrors: PreviewValidationError[];
  previewValidationMissingNames: string[];
  // Feature 3: AI auto-filter state. `aiDecisions` keys by component name and
  // is updated incrementally as the select-agent subprocess emits stderr
  // progress lines. `aiFilterStatus` drives the scope-gate's running banner.
  aiFilterStatus: 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';
  aiFilterProgress: { done: number; total: number } | null;
  aiDecisions: Record<string, { decision: 'accepted' | 'rejected' | 'failed'; reason: string }>;
  aiFilterError: string | null;
  // Wizard prefetch refactor: tracked as inline state on the credentials screen
  // rather than a dedicated `validating-credentials` step.
  credentialsValidating: boolean;
  // Background generation prefetch (kicked off from scope-gate confirm so the
  // operator's credential-entry time overlaps with the LLM call).
  generatePrefetchStatus: 'idle' | 'running' | 'complete' | 'failed';
  generatePrefetchError: string | null;
  // Skip-credentials escape hatch (see dsi-tui-skip-credentials spec).
  // When true, the wizard advanced past the credentials step without
  // validating creds. Downstream effects: previewImport is bypassed,
  // push is disabled at the push-decision-gate, and runPush refuses to
  // execute if it's somehow reached.
  credentialsSkipped: boolean;
  /** Task 8 — id of the most recent run record written to runs.json. */
  lastRunId: string | null;
  /**
   * INTEG-4411 refined: message surfaced as an inline banner on the
   * final-review screen when the wizard routes back after the preview API
   * returned an empty diff (pure no-op push). Non-null routes GenerateReviewStep
   * to render the `⚠ …` banner via the `initialFinalizeError` prop.
   */
  finalizeErrorBanner: string | null;
};

function findCliPath(): string {
  return join(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..', 'bin', 'cli.js');
}

export function buildSelectAgentArgs(opts: {
  sessionId: string;
  agent: string;
  /** Parity-audit Q4: forward `--model` override from `experiences import`. */
  model?: string;
  /** Feature 8: forward to the spawned select-agent subprocess. */
  selectPromptPath?: string;
  /**
   * Forward the operator's `experiences import --no-cache` through to the
   * spawned `analyze select-agent` so PR #59's per-component select-cache is
   * bypassed on this run. Default (omitted/false) preserves cache behavior.
   */
  noCache?: boolean;
}): string[] {
  // Feature 3: the wizard auto-filter run should never fail-loud on validation
  // errors — those components surface in the AI-excluded section with a
  // synthesized reason, not an exit-1 abort. So we always pass --exclude-invalid.
  const args = ['analyze', 'select-agent', '--agent', opts.agent, '--session', opts.sessionId, '--exclude-invalid'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.selectPromptPath) args.push('--select-prompt-path', opts.selectPromptPath);
  if (opts.noCache) args.push('--no-cache');
  return args;
}

export type AutoFilterProgress = {
  n: number;
  total: number;
  decision: 'accepted' | 'rejected' | 'failed';
  name: string;
  reason: string;
};

export function parseAutoFilterProgressLine(line: string): AutoFilterProgress | null {
  // Format: progress=select-agent:N/M:<decision>:<name>:<url-encoded-reason>
  // Name and reason CANNOT contain `:` raw (name comes from component identifier
  // which forbids colons; reason is URL-encoded). We split with a limit so any
  // stray colon inside the URL-encoded reason wouldn't matter — but the encoder
  // also handles `:` as `%3A` so this is defensive.
  const prefix = 'progress=select-agent:';
  if (!line.startsWith(prefix)) return null;
  const rest = line.slice(prefix.length);
  const parts = rest.split(':');
  if (parts.length < 4) return null;
  const [counter, decision, name, ...reasonParts] = parts;
  if (!counter) return null;
  const counterMatch = /^(\d+)\/(\d+)$/.exec(counter);
  if (!counterMatch) return null;
  if (decision !== 'accepted' && decision !== 'rejected' && decision !== 'failed') return null;
  if (!name) return null;
  const encodedReason = reasonParts.join(':');
  let reason = '';
  try {
    reason = decodeURIComponent(encodedReason);
  } catch {
    reason = encodedReason;
  }
  return {
    n: Number(counterMatch[1]),
    total: Number(counterMatch[2]),
    decision,
    name,
    reason,
  };
}

export function buildGenerateComponentsArgs(opts: {
  sessionId: string;
  tokensPath?: string;
  agent: string;
  /** Parity-audit Q4: forward `--model` override from `experiences import`. */
  model?: string;
  noCache?: boolean;
  /** Feature 8: forward to the spawned generate components subprocess. */
  generatePromptPath?: string;
}): string[] {
  // Default behavior preserves the SHA cache (re-runs only re-classify
  // changed components). The operator opts into a full re-classify pass via
  // `experiences import --no-cache`, which forwards through to the spawned
  // `generate components` subprocess. See wizard-cache.test.ts.
  const args = ['generate', 'components', '--agent', opts.agent, '--session', opts.sessionId];
  if (opts.tokensPath) args.push('--tokens', opts.tokensPath);
  if (opts.model) args.push('--model', opts.model);
  if (opts.noCache) args.push('--no-cache');
  if (opts.generatePromptPath) args.push('--generate-prompt-path', opts.generatePromptPath);
  return args;
}

export function formatAcceptanceSummary(opts: { accepted: number; autoRejected: number }): string {
  const acceptedClause = `${opts.accepted} component${opts.accepted === 1 ? '' : 's'} accepted`;
  if (opts.autoRejected === 0) return `${acceptedClause}.`;
  return `${acceptedClause}, ${opts.autoRejected} excluded due to validation errors.`;
}

function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    execFile('node', [findCliPath(), ...args], (error, stdout, stderr) => {
      res({ exitCode: error?.code ? Number(error.code) : 0, stdout, stderr });
    });
  });
}

/**
 * Parse the `wrote tokens.json (N tokens)` confirmation line emitted by
 * `experiences print tokens`. Returns 0 when the line cannot be parsed —
 * the wizard still records the run; downstream consumers should treat 0 as
 * "unknown" rather than "no tokens".
 */
export function parsePrintTokensCount(stdout: string): number {
  const m = /\((\d+)\s+token/.exec(stdout);
  return m ? Number(m[1]) : 0;
}

const WIZARD_LOG = join(tmpdir(), 'experiences-import-wizard.log');

function logStep(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  appendFileSync(WIZARD_LOG, line);
  // Tee into the unified debug log when enabled — cheap no-op otherwise.
  getDebugLogger().event('wizard', 'step', entry);
}

export type WizardAppProps = {
  initialSpaceId?: string;
  initialEnvironmentId?: string;
  initialCmaToken?: string;
  initialHost?: string;
  initialAgent?: string;
  /** Parity-audit Q4: resolved model override (flag || stored value). */
  initialModel?: string;
  initialProjectPath?: string;
  host?: string;
  autoAcceptScope?: boolean;
  noCache?: boolean;
  // Feature 3: when false, skip the auto-AI-filter subprocess after extract.
  // Default true (auto-filter ON). Plumbed from `experiences import` via
  // `--no-auto-filter`.
  autoFilter?: boolean;
  // Feature 2: when false, skip the post-FieldEditor-save live preview
  // re-run. Default true (live-preview ON). Plumbed from
  // `experiences import` via `--no-live-preview`.
  livePreview?: boolean;
  // When true, skip the credentials/preview/push branch entirely. The wizard
  // runs extract → scope-gate → generate → final-review and exits via
  // print-gate. Plumbed from `experiences import` via `--no-push`.
  noPush?: boolean;
  // When true, push without writing components.json / tokens.json to disk.
  // Mutually exclusive with `noPush` (validated at the CLI surface).
  // Plumbed from `experiences import` via `--no-save`. Default false.
  noSave?: boolean;
  /** Task 4 — `--out-dir <path>` flag. Bypasses the inline save-path prompt. */
  outDirOverride?: string;
  /**
   * Task 5 — `--on-conflict <overwrite|skip|fail>` flag. When supplied along
   * with `outDirOverride`, the wizard skips the SaveConflictGate and applies
   * the chosen mode automatically via `resolveSavePath`.
   */
  onConflictMode?: OnConflictMode;
  /**
   * Feature 8: custom prompt path overrides forwarded to the spawned
   * `analyze select-agent` and `generate components` subprocesses. When set,
   * the wizard also renders a persistent top-of-screen banner so the operator
   * cannot miss that bundled invariants are bypassed.
   */
  selectPromptPath?: string;
  generatePromptPath?: string;
  /**
   * Modify-entry: when set, the wizard treats extract as already-run and
   * seeds `state.extractSessionId` from this value. Combined with
   * `initialStep: 'final-review'`, the wizard skips welcome → token-input →
   * checking-claude-auth → extracting → scope-gate and lands directly on
   * the post-generate review screen using DB-backed reads.
   */
  seedExtractSessionId?: string;
  /**
   * Modify-entry: when set, the wizard treats generate as already-run and
   * seeds `state.generateSessionId`. Required (together with
   * `seedExtractSessionId`) for the final-review short-circuit to render
   * meaningful data.
   */
  seedGenerateSessionId?: string;
  /**
   * Modify-entry: when set, the wizard treats the tokens step as already-run
   * and seeds `state.tokenSessionId`. Without this, the modify entry would
   * leave tokens unaddressable — push would skip them and `runPrintFiles`
   * would never re-emit `tokens.json` for the modified save path.
   */
  seedTokenSessionId?: string;
  /**
   * Push-from-picker entry: overrides `state.tokensPath` so runPreview can
   * read the run record's saved tokens.json without waiting for the wizard
   * to re-emit it (push-from-picker skips the save flow entirely).
   */
  seedTokensPath?: string;
  /**
   * Modify-entry: overrides the wizard's initial step. When set, the wizard
   * bypasses its normal welcome/token-input bootstrap. Currently only
   * `'final-review'` is plumbed end-to-end; `'scope-gate'` is accepted for
   * future use but falls through to standard behavior.
   */
  initialStep?: 'scope-gate' | 'final-review' | 'push-from-picker';
  /**
   * Headless raw-token source path. When set (and the modify-entry props
   * are not), the wizard seeds `state.rawTokensPath` and lands directly on
   * the `generating-tokens` step, skipping welcome + token-input. The
   * existing `generating-tokens` effect then drives token classification
   * via `generate tokens --raw-tokens <path>` just as if the operator had
   * submitted the interactive `TokenInputStep`.
   */
  initialRawTokensPath?: string;
  /**
   * When set with a non-empty array, the wizard opens with the run picker
   * instead of the welcome step. The picker invokes `onRunPicked` with the
   * operator's selection so the CLI surface can route into
   * `--push-from-run` / `--modify` entry points (or fall through to the
   * normal welcome step on 'new').
   */
  initialRuns?: RunRecord[];
  onRunPicked?: (selection: RunPickerSelection) => void;
};

export function WizardApp({
  initialSpaceId = '',
  initialEnvironmentId = 'master',
  initialCmaToken = '',
  initialHost,
  initialAgent,
  initialModel,
  initialProjectPath,
  host,
  autoAcceptScope = false,
  noCache = false,
  autoFilter = true,
  livePreview = true,
  noPush = false,
  noSave = false,
  outDirOverride,
  onConflictMode,
  selectPromptPath,
  generatePromptPath,
  seedExtractSessionId,
  seedGenerateSessionId,
  seedTokenSessionId,
  seedTokensPath,
  initialStep,
  initialRawTokensPath,
  initialRuns,
  onRunPicked,
}: WizardAppProps = {}): React.ReactElement {
  const defaultConfiguredHost = toConfiguredHost(host || process.env['EDS_HOST']) ?? DEFAULT_CONFIGURED_HOST;
  const resolveWizardHost = (hostValue?: string): string => hostValue || defaultConfiguredHost;
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  const logInit = useRef(false);
  if (!logInit.current) {
    writeFileSync(WIZARD_LOG, `--- experiences import session ${new Date().toISOString()} ---\n`);
    logInit.current = true;
  }

  const credentialsRef = useRef<{
    spaceId: string;
    environmentId: string;
    cmaToken: string;
  } | null>(null);
  const sessionRef = useRef<{
    extractSessionId: string | null;
    tokensPath: string;
  }>({
    extractSessionId: null,
    tokensPath: '',
  });

  // Feature 3: holds the spawned `analyze select-agent` subprocess so the
  // scope-gate's `q` (during running) can SIGTERM it for cancellation.
  const autoFilterChildRef = useRef<import('node:child_process').ChildProcess | null>(null);
  // Promise that resolves when the auto-filter subprocess fully exits. Used
  // by `cancelAutoFilterAndWait` so scope-gate confirm can guarantee its
  // snapshot write goes AFTER the subprocess's last write.
  const autoFilterDonePromiseRef = useRef<Promise<void> | null>(null);

  // Background `generate components` subprocess spawned from scope-gate
  // confirm so its LLM call overlaps with the operator's credential entry.
  // Held in refs so we can SIGTERM on credential failure / quit, and await
  // the promise from inside `validateCredentials` once creds come back OK.
  const generateChildRef = useRef<import('node:child_process').ChildProcess | null>(null);
  const generatePromiseRef = useRef<Promise<{
    exitCode: number;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }> | null>(null);

  // Modify-entry short-circuit: when the launcher passes seed session IDs
  // and `initialStep: 'final-review'`, skip the welcome/token-input bootstrap
  // and land directly on the post-generate review screen. The DB-backed
  // GenerateReviewStep loads its data off `state.extractSessionId`, so all
  // we need to do here is seed the IDs and the step.
  const modifyEntryReady = !!seedExtractSessionId && initialStep === 'final-review';
  // Push-from-picker entry: the run-picker's Push action mounts the wizard
  // with seeded session IDs and `initialStep: 'push-from-picker'` so the
  // operator sees the same preview + push UX as a fresh import. Skips
  // welcome, token-input, scope-gate, final-review, and push-decision-gate;
  // an effect below dispatches `runPreview` on mount which drives
  // previewing → pushing → done.
  const pushFromPickerReady = !!seedExtractSessionId && initialStep === 'push-from-picker';
  // Headless raw-tokens entry: when the operator passed `--raw-tokens <path>`
  // the CLI seeds this prop. Skip welcome + token-input and land on the
  // `generating-tokens` step which already drives the token-classification
  // subprocess off `state.rawTokensPath`. Modify-entry wins if both are set.
  const rawTokensEntryReady = !modifyEntryReady && !pushFromPickerReady && !!initialRawTokensPath;
  const initialStepResolved: WizardStep = modifyEntryReady
    ? 'final-review'
    : pushFromPickerReady
      ? 'push-from-picker'
      : rawTokensEntryReady
        ? 'generating-tokens'
        : initialProjectPath
          ? 'token-input'
          : 'welcome';
  const initialOutDir = initialProjectPath ? join(resolve(initialProjectPath), '.contentful') : '';
  const initialTokensPath =
    (modifyEntryReady || pushFromPickerReady) && initialOutDir ? join(initialOutDir, 'tokens.json') : '';

  const [state, setState] = useState<WizardState>({
    step:
      modifyEntryReady || rawTokensEntryReady || pushFromPickerReady
        ? initialStepResolved
        : initialRuns && initialRuns.length > 0
          ? 'run-picker'
          : initialStepResolved,
    agent: initialAgent ?? 'claude',
    ...(initialModel ? { agentModel: initialModel } : {}),
    projectPath: initialProjectPath ?? '',
    outDir: initialOutDir,
    rawTokensPath: rawTokensEntryReady ? initialRawTokensPath! : '',
    tokensPath: seedTokensPath ?? initialTokensPath,
    tokenSourceChanged: null,
    skipComponents: false,
    tokenSessionId: seedTokenSessionId ?? null,
    tokenCount: 0,
    extractSessionId: seedExtractSessionId ?? null,
    generateSessionId: seedGenerateSessionId ?? null,
    extractedCount: 0,
    acceptedCount: 0,
    autoRejectedCount: 0,
    generatedCount: 0,
    generatedAcceptedCount: 0,
    renamedSlotsCount: 0,
    generateProgress: null,
    extractProgress: null,
    componentsPath: '',
    spaceId: initialSpaceId,
    environmentId: initialEnvironmentId,
    cmaToken: initialCmaToken,
    host: resolveWizardHost(toConfiguredHost(initialHost)),
    credentialsError: '',
    serverPreview: null,
    manifest: null,
    pushProgress: null,
    pushResult: {
      componentTypes: { created: 0, updated: 0, removed: 0, failed: 0 },
      designTokens: { created: 0, updated: 0, removed: 0, failed: 0 },
    },
    errorStep: '',
    errorMessage: '',
    errorAllowCredentialRetry: false,
    authCheckStepNumber: 1,
    previewValidationErrors: [],
    previewValidationMissingNames: [],
    aiFilterStatus: 'idle',
    aiFilterProgress: null,
    aiDecisions: {},
    aiFilterError: null,
    credentialsValidating: false,
    generatePrefetchStatus: 'idle',
    generatePrefetchError: null,
    credentialsSkipped: false,
    lastRunId: null,
    finalizeErrorBanner: null,
  });

  useEffect(() => {
    sessionRef.current = {
      extractSessionId: state.extractSessionId,
      tokensPath: state.tokensPath,
    };
  }, [state.extractSessionId, state.tokensPath]);

  const update = (partial: Partial<WizardState>) => {
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
    if (sanitized.manifest) (sanitized as Record<string, unknown>).manifest = '[manifest]';
    if ((sanitized as Record<string, unknown>).cmaToken) (sanitized as Record<string, unknown>).cmaToken = '[redacted]';
    logStep({ update: sanitized });
    setState((prev) => ({ ...prev, ...partial }));
  };

  // ── Agent auth pre-flight ───────────────────────────────────────────────────────

  const runAgentAuthCheck = async (nextStep: WizardStep): Promise<boolean> => {
    const authCheckStepNumber = nextStep === 'generating-tokens' ? 1 : state.tokensPath ? 4 : 3;
    update({ step: 'checking-claude-auth', authCheckStepNumber });
    const status = await checkAgentAuth(state.agent as AgentName);
    if (status === 'not-found') {
      update({
        step: 'error',
        errorStep: `${state.agent} auth check`,
        errorMessage: `The \`${state.agent}\` CLI was not found on your PATH.\n\nInstall it, then re-run \`experiences import\`.`,
      });
      return false;
    }
    if (status === 'unauthenticated') {
      update({
        step: 'error',
        errorStep: `${state.agent} auth check`,
        errorMessage:
          `${state.agent} is not authenticated.\n\n` +
          `Run \`${state.agent}\` in your terminal to log in, then re-run \`experiences import\`.\n\n` +
          'If you are using AWS Bedrock, run:\n' +
          '  aws sso login --profile <your-profile>',
      });
      return false;
    }
    update({ step: nextStep });
    return true;
  };

  // ── Step runners ────────────────────────────────────────────────────────

  const runGenerateTokens = async (rawTokensPath: string, outDir: string) => {
    const result = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>((res) => {
      const tokenArgs = [findCliPath(), 'generate', 'tokens', '--agent', state.agent, '--raw-tokens', rawTokensPath];
      if (state.agentModel) tokenArgs.push('--model', state.agentModel);
      const child = spawn('node', tokenArgs);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += String(d);
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += String(d);
      });
      child.on('exit', (code) => res({ exitCode: code ?? 0, stdout, stderr }));
    });
    if (result.exitCode !== 0) {
      update({
        step: 'error',
        errorStep: 'generate tokens',
        errorMessage: result.stderr.trim() || 'Unknown error',
      });
      return;
    }
    const sessionMatch = /^session=(.+)$/m.exec(result.stdout);
    const tokenSessionId = sessionMatch ? sessionMatch[1]!.trim() : null;

    const tokensPath = join(outDir, 'tokens.json');
    const printArgs = ['print', 'tokens', '--out', tokensPath];
    if (tokenSessionId) printArgs.push('--session', tokenSessionId);
    const r = await runCli(printArgs);
    if (r.exitCode !== 0) {
      update({
        step: 'error',
        errorStep: 'print tokens',
        errorMessage: r.stderr.trim() || 'Unknown error',
      });
      return;
    }
    const tokenCount = parsePrintTokensCount(r.stdout);
    update({ step: 'path-validation', tokensPath, tokenSessionId, tokenCount });
  };

  const runExtract = async (projectPath: string) => {
    const outDir = join(resolve(projectPath), '.contentful');
    update({ step: 'extracting', outDir, extractProgress: null });
    const r = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>((res) => {
      const child = spawn('node', [findCliPath(), 'analyze', 'extract', '--project', projectPath]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += String(d);
      });
      child.stderr.on('data', (d: Buffer) => {
        const chunk = String(d);
        stderr += chunk;
        for (const line of chunk.split('\n')) {
          const scanMatch = /^progress=scan:(\d+)$/.exec(line.trim());
          if (scanMatch) {
            const scanned = Number(scanMatch[1]);
            setState((prev) => ({
              ...prev,
              extractProgress: {
                scanned,
                filesProcessed: prev.extractProgress?.filesProcessed ?? 0,
                totalFiles: prev.extractProgress?.totalFiles ?? 0,
                componentsFound: prev.extractProgress?.componentsFound ?? 0,
              },
            }));
            continue;
          }
          const extractMatch = /^progress=extract:(\d+)\/(\d+):(\d+)$/.exec(line.trim());
          if (extractMatch) {
            const filesProcessed = Number(extractMatch[1]);
            const totalFiles = Number(extractMatch[2]);
            const componentsFound = Number(extractMatch[3]);
            setState((prev) => ({
              ...prev,
              extractProgress: {
                scanned: prev.extractProgress?.scanned ?? 0,
                filesProcessed,
                totalFiles,
                componentsFound,
              },
            }));
          }
        }
      });
      child.on('exit', (code) => res({ exitCode: code ?? 0, stdout, stderr }));
    });
    if (r.exitCode !== 0) {
      update({
        step: 'error',
        errorStep: 'analyze extract',
        errorMessage: r.stderr.trim() || 'Unknown error',
      });
      return;
    }
    const sessionMatch = /^session=(.+)$/m.exec(r.stdout);
    const extractSessionId = sessionMatch ? sessionMatch[1]!.trim() : null;
    const countMatch = /Extracted (\d+) components?/.exec(r.stderr);
    const extractedCount = countMatch ? Number(countMatch[1]) : 0;
    if (extractedCount === 0) {
      update({
        step: 'error',
        errorStep: 'analyze extract',
        errorMessage: `No components found in ${projectPath}.\n\nMake sure this path contains TypeScript/React/Vue component files (.tsx, .ts, .vue, etc.).`,
      });
      return;
    }
    update({
      step: 'scope-gate',
      extractSessionId,
      extractedCount,
      aiFilterStatus: autoFilter ? 'running' : 'idle',
      aiFilterProgress: autoFilter ? { done: 0, total: extractedCount } : null,
      aiDecisions: {},
      aiFilterError: null,
    });
    if (autoFilter && extractSessionId) {
      autoFilterDonePromiseRef.current = runAutoFilter(extractSessionId);
    }
  };

  // Feature 3: spawn `analyze select-agent` after extract and stream decisions
  // into wizard state via stderr progress lines. The subprocess writes
  // `raw_components.status` + `reject_reason` itself (see Task 2), so the
  // scope-gate UI re-loads via `loadScopeComponents` to get fresh data on every
  // render — but we also keep a memory-side `aiDecisions` map for streaming UX.
  const runAutoFilter = (sessionId: string): Promise<void> => {
    return new Promise((res) => {
      const args = buildSelectAgentArgs({
        sessionId,
        agent: state.agent,
        ...(state.agentModel ? { model: state.agentModel } : {}),
        selectPromptPath,
        noCache,
      });
      const child = spawn('node', [findCliPath(), ...args]);
      autoFilterChildRef.current = child;
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => {
        const chunk = String(d);
        stderr += chunk;
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parsed = parseAutoFilterProgressLine(trimmed);
          if (!parsed) continue;
          setState((prev) => ({
            ...prev,
            aiFilterProgress: { done: parsed.n, total: parsed.total },
            aiDecisions: {
              ...prev.aiDecisions,
              [parsed.name]: { decision: parsed.decision, reason: parsed.reason },
            },
          }));
        }
      });
      // Use 'close' (not 'exit') so the status flip happens after the child's
      // stdio AND its inherited SQLite WAL/SHM file handles have been fully
      // released by the OS. 'exit' fires the instant the process terminates;
      // setting state then triggers a wizard re-render that re-opens
      // pipeline.db from the scope-gate step, and the lock from the dead
      // child's still-mapped WAL handle surfaces as "database is locked".
      child.on('close', (code, signal) => {
        autoFilterChildRef.current = null;
        if (signal === 'SIGTERM') {
          setState((prev) => ({ ...prev, aiFilterStatus: 'cancelled' }));
        } else if ((code ?? 0) !== 0) {
          const tail = buildAutoFilterErrorTail(stderr);
          setState((prev) => ({
            ...prev,
            aiFilterStatus: 'failed',
            aiFilterError: tail || `exit ${code}`,
          }));
        } else {
          setState((prev) => ({ ...prev, aiFilterStatus: 'complete' }));
        }
        res();
      });
      child.on('error', (err) => {
        autoFilterChildRef.current = null;
        setState((prev) => ({
          ...prev,
          aiFilterStatus: 'failed',
          aiFilterError: err.message,
        }));
        res();
      });
    });
  };

  const cancelAutoFilter = (): void => {
    const child = autoFilterChildRef.current;
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // best-effort
      }
    }
  };

  // Variant that returns a Promise resolving when the subprocess has fully
  // exited. Used by scope-gate confirm to guarantee operator-write-last
  // ordering on the review-state snapshot (PR #43 race fix).
  const cancelAutoFilterAndWait = async (): Promise<void> => {
    const child = autoFilterChildRef.current;
    const donePromise = autoFilterDonePromiseRef.current;
    if (!child || child.killed) {
      // Subprocess already gone (or never started). If the Promise is still
      // pending — e.g. exit handler hasn't fired yet — await it; otherwise
      // resolve immediately.
      if (donePromise) await donePromise;
      return;
    }
    try {
      child.kill('SIGTERM');
    } catch {
      // best-effort
    }
    if (donePromise) await donePromise;
  };

  // Cancel a running generation prefetch (SIGTERM the child + clear refs +
  // reset state). Best-effort — if the child has already exited, this is a
  // no-op aside from clearing the prefetch status.
  const cancelGeneratePrefetch = (): void => {
    const child = generateChildRef.current;
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // best-effort
      }
    }
    generateChildRef.current = null;
    generatePromiseRef.current = null;
    setState((prev) => ({
      ...prev,
      generatePrefetchStatus: 'idle',
      generatePrefetchError: null,
      generateProgress: null,
    }));
  };

  // Spawn `generate components` in the background. Wires up the same
  // stderr-progress streaming as `runGenerate` but stores the in-flight
  // promise in a ref so the post-credentials path can await it.
  const startGeneratePrefetch = (
    extractSessionId: string,
    tokensPath: string,
  ): Promise<{
    exitCode: number;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }> => {
    const args = [
      findCliPath(),
      ...buildGenerateComponentsArgs({
        sessionId: extractSessionId,
        tokensPath,
        agent: state.agent,
        ...(state.agentModel ? { model: state.agentModel } : {}),
        noCache,
      }),
    ];
    let progressCursor: GenerateProgressState = null;
    const { child, donePromise } = spawnGenerateChild({
      command: 'node',
      args,
      onStderr: (chunk) => {
        const nextProgress = parseGenerateStderrChunk(chunk, progressCursor);
        if (nextProgress !== progressCursor) {
          progressCursor = nextProgress;
          setState((prev) => ({ ...prev, generateProgress: nextProgress }));
        }
      },
    });
    generateChildRef.current = child;
    generatePromiseRef.current = donePromise;
    setState((prev) => ({
      ...prev,
      generatePrefetchStatus: 'running',
      generatePrefetchError: null,
    }));
    donePromise
      .then((result) => {
        // Clear the child ref regardless of how it ended.
        generateChildRef.current = null;
        if (result.signal === 'SIGTERM') {
          // Caller already reset state via cancelGeneratePrefetch.
          return;
        }
        if (result.exitCode !== 0) {
          const tail = result.stderr.trim().split('\n').slice(-3).join('\n') || `exit ${result.exitCode}`;
          setState((prev) => ({
            ...prev,
            generatePrefetchStatus: 'failed',
            generatePrefetchError: tail,
            generateProgress: null,
          }));
          return;
        }
        const sessionMatch = /^session=(.+)$/m.exec(result.stdout);
        const generateSessionId = sessionMatch ? sessionMatch[1]!.trim() : null;
        const countMatch = /(\d+) components?/.exec(result.stderr);
        const generatedCount = countMatch ? Number(countMatch[1]) : 0;
        const renamedMatch = /^renamed-slots:\s*(\d+)$/m.exec(result.stdout);
        const renamedSlotsCount = renamedMatch ? Number(renamedMatch[1]) : 0;
        // Persist generated state but DO NOT auto-advance — the credentials
        // path will pick this up via `advanceAfterCredentialsValidated`.
        setState((prev) => ({
          ...prev,
          generateSessionId,
          generatedCount,
          renamedSlotsCount,
          generateProgress: null,
          generatePrefetchStatus: 'complete',
        }));
      })
      .catch(() => {
        generateChildRef.current = null;
        setState((prev) => ({
          ...prev,
          generatePrefetchStatus: 'failed',
          generatePrefetchError: 'subprocess error',
        }));
      });
    return donePromise;
  };

  const runGenerate = async (extractSessionId: string, tokensPath: string, acceptedCount: number) => {
    const args = [
      findCliPath(),
      ...buildGenerateComponentsArgs({
        sessionId: extractSessionId,
        tokensPath,
        agent: state.agent,
        ...(state.agentModel ? { model: state.agentModel } : {}),
        noCache,
        generatePromptPath,
      }),
    ];
    let progressCursor: GenerateProgressState = state.generateProgress;
    const { donePromise } = spawnGenerateChild({
      command: 'node',
      args,
      onStderr: (chunk) => {
        const nextProgress = parseGenerateStderrChunk(chunk, progressCursor);
        if (nextProgress !== progressCursor) {
          progressCursor = nextProgress;
          update({ generateProgress: nextProgress });
        }
      },
    });
    const result = await donePromise;

    if (result.exitCode !== 0) {
      update({
        step: 'error',
        errorStep: 'generate components',
        errorMessage: result.stderr.trim() || 'Unknown error',
      });
      return;
    }
    const sessionMatch = /^session=(.+)$/m.exec(result.stdout);
    const generateSessionId = sessionMatch ? sessionMatch[1]!.trim() : null;
    const countMatch = /(\d+) components?/.exec(result.stderr);
    const generatedCount = countMatch ? Number(countMatch[1]) : acceptedCount;
    const renamedMatch = /^renamed-slots:\s*(\d+)$/m.exec(result.stdout);
    const renamedSlotsCount = renamedMatch ? Number(renamedMatch[1]) : 0;
    update({
      step: 'final-review',
      generateSessionId,
      generatedCount,
      renamedSlotsCount,
      generateProgress: null,
    });
  };

  const advanceToPushFlow = (generatedAcceptedCount: number) => {
    update({ generatedAcceptedCount, step: 'credentials' });
  };

  const runEditFromPreview = async () => {
    // Post-preview edits land in the unified final-review screen.
    update({ step: 'final-review' });
  };

  const runSkipValidationErrorsAndRetry = async (errors: PreviewValidationError[]) => {
    await applySkipValidationErrors(state.extractSessionId, errors);
    const { extractSessionId: sid, tokensPath: tp } = sessionRef.current;
    void runPreview(sid, tp, state.spaceId, state.environmentId, state.cmaToken, state.host);
  };

  const advanceWithCredentials = (spaceId: string, environmentId: string, cmaToken: string, host: string) => {
    const resolvedHost = resolveWizardHost(host);
    credentialsRef.current = { spaceId, environmentId, cmaToken };
    // The dedicated `credential-test-gate` screen was dropped — credentials are
    // now always validated immediately after they're persisted. The inline
    // `credentialsValidating` status (PR #54) handles the visual feedback while
    // the API ping is in flight. The literal `'credential-test-gate'` is kept
    // in the WizardStep union for back-compat, but is never set as a step.
    void validateCredentials(spaceId, environmentId, cmaToken, resolvedHost);
  };

  const confirmCredentials = async (spaceId: string, environmentId: string, cmaToken: string, host: string) => {
    const resolvedHost = resolveWizardHost(host);
    try {
      await writeExperiencesCredentials({
        spaceId,
        environmentId,
        cmaToken,
        host: resolvedHost,
      });
      advanceWithCredentials(spaceId, environmentId, cmaToken, resolvedHost);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to save credentials';
      update({
        spaceId,
        environmentId,
        cmaToken,
        host: resolvedHost,
        credentialsError: `Failed to save credentials: ${message}`,
        step: 'credentials',
      });
    }
  };

  const validateCredentials = async (spaceId: string, environmentId: string, cmaToken: string, host: string) => {
    // Inline validation: stay on the credentials step, flip the validating
    // boolean so CredentialsStep locks input + renders an inline status.
    update({ step: 'credentials', credentialsValidating: true, credentialsError: '' });
    try {
      const resolvedHost = resolveWizardHost(host);
      const client = new ImportApiClient({
        cmaToken,
        spaceId,
        environmentId,
        host: resolvedHost,
      });
      await client.validateToken();
      update({ credentialsValidating: false });
      await advanceAfterCredentialsValidated();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        // Validation failure: cancel any in-flight generate prefetch so we
        // don't leave an orphaned subprocess running after the operator backs
        // out (Risk #1 in the spec).
        cancelGeneratePrefetch();
        update({ step: 'credentials', credentialsValidating: false, credentialsError: e.message });
        return;
      }
      const msg = e instanceof Error ? e.message : 'Credential check failed';
      cancelGeneratePrefetch();
      update({
        step: 'error',
        errorStep: 'validating-credentials',
        errorMessage: msg,
        errorAllowCredentialRetry: false,
        credentialsValidating: false,
      });
    }
  };

  // Branch after credentials are known good (validated, or skipped via the
  // credential-test-gate skip path). Either runs the generator (if there are
  // accepted components) or jumps straight to push-decision-gate (if scope
  // rejected everything but tokens/removals still need to be pushed).
  const advanceAfterCredentialsValidated = async () => {
    // If we already ran the generator (re-entering credentials from a late
    // 401/403 raised by runPreview), skip back to push-decision-gate rather
    // than re-running the LLM.
    if (state.generateSessionId) {
      update({ step: 'push-decision-gate' });
      return;
    }
    const next = nextStepAfterCredentialsValidated({ acceptedCount: state.acceptedCount });
    if (next === 'generating') {
      const sid = sessionRef.current.extractSessionId;
      if (!sid) {
        update({
          step: 'error',
          errorStep: 'post-credentials',
          errorMessage: 'Internal error: extract session ID missing after credential validation.',
        });
        return;
      }
      // Prefetch path: if a background generate is already running or has
      // already completed, await it (or use its result) instead of spawning
      // a second LLM call. Transition to 'generating' first so the operator
      // sees the familiar RunningStep progress screen while we wait —
      // matching the no-prefetch flow's visual.
      const inflight = generatePromiseRef.current;
      if (inflight) {
        update({ step: 'generating' });
        const result = await inflight;
        generatePromiseRef.current = null;
        if (result.exitCode === 0 && result.signal !== 'SIGTERM') {
          // The donePromise.then() handler already populated
          // generateSessionId / generatedCount in state. Advance to
          // final-review using the latest values via functional setState so
          // we read whichever update landed last.
          setState((prev) => ({ ...prev, step: 'final-review' }));
          return;
        }
        // Prefetch failed — fall through to retry via a fresh runGenerate.
      }
      if (await runAgentAuthCheck('generating')) {
        void runGenerate(sid, state.tokensPath, state.acceptedCount);
      }
      return;
    }
    update({ step: 'push-decision-gate' });
  };

  const runPreview = async (
    extractSessionId: string | null,
    tokensPath: string,
    spaceId: string,
    environmentId: string,
    cmaToken: string,
    host: string,
  ) => {
    // Skip-credentials short-circuit. When the operator pressed `s` on the
    // credentials screen, we never got a working token — calling
    // previewImport would 401/403 (or worse, send a half-formed manifest
    // somewhere). Jump straight to the push-decision-gate; Task 3 disables
    // the push options downstream.
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
      let manifest = buildManifest(components, tokens);
      let preview = await client.previewImport(manifest);

      // Second pass: seed CDF from false removals + preserve defaults from changed items
      if (extractSessionId) {
        let needsRepreview = false;
        const db = openPipelineDb();
        try {
          // Seed CDF for components server thinks are removed but exist locally
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

          // Preserve server-side defaults so we don't accidentally propose removing them
          if (preview.components.changed.length > 0) {
            const seededDefaults = seedDefaultsFromChangedItems(db, extractSessionId, preview.components.changed);
            if (seededDefaults > 0) needsRepreview = true;
          }

          if (needsRepreview) {
            components = loadCDFComponents(db, extractSessionId);
            manifest = buildManifest(components, tokens);
            preview = await client.previewImport(manifest);
          }
        } finally {
          db.close();
        }
      }

      // INTEG-4411 refined: preview-aware finalize guard. If the resulting
      // push would be a pure no-op across every diff bucket, don't send an
      // empty manifest to EDSI — route back to `final-review` with an inline
      // banner. Accepted components, rejections that remove server-side
      // components, and token-only diffs all keep this branch from firing.
      if (isEmptyPreview(preview)) {
        update({
          step: 'final-review',
          finalizeErrorBanner: 'Nothing to push — accept a component, reject a component that exists in Contentful, or quit.',
          serverPreview: preview,
          ...clearedValidationErrorState(),
        });
        return;
      }
      update({
        step: 'preview-gate',
        serverPreview: preview,
        manifest,
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
          // Space-level config errors (e.g. "Design system public CMA is disabled") cannot be
          // fixed by re-entering credentials — send to error screen.
          if (bodyMsg && /disabled/i.test(bodyMsg)) {
            update({
              step: 'error',
              errorStep: 'apply preview',
              errorMessage: `Preview failed: ${bodyMsg}`,
              errorAllowCredentialRetry: false,
            });
            return;
          }
          update({ step: 'credentials', credentialsError: e.message });
          return;
        }
        if (e.status === 404) {
          // 404 from previewImport means the design systems endpoint doesn't exist for this
          // space/environment (typically wrong --host or wrong space/env). Not a credentials
          // problem — show a clear error instead of looping.
          update({
            step: 'error',
            errorStep: 'apply preview',
            errorAllowCredentialRetry: true,
            errorMessage:
              `Not found (404). Check that the space ID, environment ID, and host are correct.\n\n` +
              `  Space:       ${spaceId}\n` +
              `  Environment: ${environmentId}\n` +
              (resolvedHost ? `  Host:        ${resolvedHost}\n` : '') +
              `\nIf using a custom --host, make sure the space exists on that host.`,
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
        // 'unparseable' and 'not-422' both fall through to the generic error branch below.
        update({
          step: 'error',
          errorStep: 'apply preview',
          errorMessage: e.message,
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
    manifest: ManifestPayload,
    spaceId: string,
    environmentId: string,
    cmaToken: string,
    host: string,
    acknowledgeBreakingChanges: boolean,
    preview?: ServerPreviewResponse | null,
  ) => {
    // Skip-credentials defensive guard. The push-decision-gate disables
    // push-emitting choices when `credentialsSkipped` is true, so we
    // should never get here in practice. But if a state-machine bug or
    // future regression ever did, refuse to issue the API call — there
    // is no validated token and the operator explicitly opted out of
    // push. Route back to the local-save (print-gate) path instead.
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
    update({ step: 'pushing', pushProgress: null });
    try {
      const resolvedHost = resolveWizardHost(host);
      const client = new ImportApiClient({
        cmaToken,
        spaceId,
        environmentId,
        host: resolvedHost,
      });
      let operation = await client.applyImport(manifest, acknowledgeBreakingChanges);
      try {
        logStep({
          applyResponse: {
            status: operation?.sys?.status,
            id: operation?.sys?.id,
            keys: Object.keys(operation ?? {}),
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
            // Best-effort fresh signal: pick the most recently succeeded item
            // (the API does not surface an in-progress status today). Falls
            // back to null and the PushingStep hides the line.
            const lastDone = items.length > 0 ? items[items.length - 1] : null;
            const current = lastDone && lastDone.status === 'succeeded' ? lastDone.id : null;
            update({
              pushProgress: { kind: 'progress', processed: done, total: s.total, current },
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
            status: operation?.sys?.status,
            keys: Object.keys(operation ?? {}),
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
        };
      } else {
        // API didn't return items — fall back to summary + preview counts
        pushResult = {
          componentTypes: {
            created: preview?.components.new.length ?? 0,
            updated: preview?.components.changed.length ?? 0,
            removed: preview?.components.removed.length ?? 0,
            failed: 0,
          },
          designTokens: {
            created: preview?.tokens.new.length ?? 0,
            updated: preview?.tokens.changed.length ?? 0,
            removed: preview?.tokens.removed.length ?? 0,
            failed: 0,
          },
          summary: operation.summary,
        };
      }
      update({ step: 'done', pushResult });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Push failed';
      update({
        step: 'error',
        errorStep: 'apply push',
        errorMessage: msg,
        errorAllowCredentialRetry: true,
      });
    }
  };

  const runPrintFiles = async (
    extractSessionId: string | null,
    outDir: string,
    opts: { skipGate?: boolean; tokenSessionId?: string | null } = {},
  ): Promise<{ ok: boolean; tokensPath?: string; tokenCount?: number }> => {
    update({ step: 'printing' });
    const componentsPath = join(outDir, 'components.json');
    const printArgs = ['print', 'components', '--out', componentsPath];
    if (extractSessionId) printArgs.push('--session', extractSessionId);
    const r = await runCli(printArgs);
    if (r.exitCode !== 0) {
      update({
        step: 'error',
        errorStep: 'print components',
        errorMessage: r.stderr.trim() || 'Unknown error',
      });
      return { ok: false };
    }
    // Co-locate tokens.json with components.json. Without this, `--out-dir`
    // would move components.json to the operator's chosen path while leaving
    // tokens.json behind at <projectPath>/.contentful/tokens.json.
    let emittedTokensPath: string | undefined;
    let emittedTokenCount: number | undefined;
    if (opts.tokenSessionId) {
      const tokensOut = join(outDir, 'tokens.json');
      const tokenArgs = ['print', 'tokens', '--out', tokensOut, '--session', opts.tokenSessionId];
      const tr = await runCli(tokenArgs);
      if (tr.exitCode !== 0) {
        update({
          step: 'error',
          errorStep: 'print tokens',
          errorMessage: tr.stderr.trim() || 'Unknown error',
        });
        return { ok: false };
      }
      emittedTokensPath = tokensOut;
      emittedTokenCount = parsePrintTokensCount(tr.stdout);
    }
    update(nextStateAfterPrint({ skipGate: opts.skipGate, componentsPath }));
    return {
      ok: true,
      ...(emittedTokensPath ? { tokensPath: emittedTokensPath } : {}),
      ...(typeof emittedTokenCount === 'number' ? { tokenCount: emittedTokenCount } : {}),
    };
  };

  const runSaveAndPush = async (): Promise<void> => {
    await startSaveFlow({ skipGate: true, andPush: true });
  };

  // ── Task 4: save-path orchestration ────────────────────────────────────────
  // Wraps every `runPrintFiles` site. When `--out-dir` is set we skip the
  // inline prompt and conflict gate entirely. Otherwise the wizard transitions
  // to the path-prompt step; the operator's submit handler calls back into
  // `proceedToWrite` (which may surface the conflict gate).

  const pendingSaveOptionsRef = useRef<{ skipGate?: boolean; andPush?: boolean }>({});

  const startSaveFlow = async (opts: { skipGate?: boolean; andPush?: boolean } = {}): Promise<void> => {
    pendingSaveOptionsRef.current = opts;
    if (outDirOverride) {
      await mkdir(outDirOverride, { recursive: true });
      if (onConflictMode) {
        const resolved = await resolveSavePath(outDirOverride, { onConflict: onConflictMode });
        if (resolved.kind === 'fail') {
          const files = resolved.conflict.files.join(', ');
          process.stderr.write(
            `Error: --on-conflict fail — refusing to overwrite ${files} at ${resolved.conflict.path}.\n`,
          );
          process.exit(1);
          return;
        }
        if (resolved.kind === 'write') {
          await mkdir(resolved.path, { recursive: true });
          await proceedToWrite(resolved.path);
          return;
        }
      }
      await proceedToWrite(outDirOverride);
      return;
    }
    setState((prev) => ({ ...prev, step: 'path-prompt' }));
  };

  const proceedToWrite = async (path: string): Promise<void> => {
    setState((prev) => ({ ...prev, outDir: path }));
    const { extractSessionId, tokensPath } = sessionRef.current;
    const { skipGate, andPush } = pendingSaveOptionsRef.current;
    const result = await runPrintFiles(extractSessionId, path, {
      ...(skipGate ? { skipGate: true } : {}),
      ...(state.tokenSessionId ? { tokenSessionId: state.tokenSessionId } : {}),
    });
    if (!result.ok) return;
    // Prefer the freshly emitted path/count (covers --out-dir); fall back to
    // the values captured during the original generate-tokens step.
    const recordedTokensPath = result.tokensPath ?? (state.tokenSessionId ? tokensPath || null : null);
    const recordedTokenCount = result.tokenCount ?? state.tokenCount;
    if (result.ok) {
      // Append a run record on every successful write. Best-effort: append
      // failures must not break the wizard flow (they surface on stderr).
      try {
        // Build the v3 fingerprints. Both are best-effort: if any step
        // throws (missing source file, hash failure, db lookup error) we
        // fall back to null fingerprints rather than aborting the save.
        let sourceFingerprint: Awaited<ReturnType<typeof buildSourceFingerprint>> | null = null;
        let savedFingerprint: ReturnType<typeof buildSavedFingerprint> | null = null;
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
        try {
          const componentsBuf = await readFile(join(path, 'components.json')).catch(() => null);
          const tokensBuf = recordedTokensPath ? await readFile(recordedTokensPath).catch(() => null) : null;
          savedFingerprint = buildSavedFingerprint({
            componentsJson: componentsBuf,
            tokensJson: tokensBuf,
          });
        } catch (err) {
          process.stderr.write(
            `Warning: failed to compute saved fingerprint: ${err instanceof Error ? err.message : String(err)}\n`,
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
          savedFingerprint,
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

  // ── Effect: kick off automatic steps ───────────────────────────────────────────────

  const tokenReuseChecked = useRef(false);
  useEffect(() => {
    if (state.step === 'generating-tokens') {
      if (tokenReuseChecked.current) return; // already checked or user chose regenerate
      tokenReuseChecked.current = true;
      const existingTokensPath = join(state.outDir, 'tokens.json');
      (async () => {
        try {
          await access(existingTokensPath);
          const [tokensStat, sourceStat] = await Promise.all([
            stat(existingTokensPath),
            stat(state.rawTokensPath).catch(() => null),
          ]);
          const sourceChanged = sourceStat ? sourceStat.mtimeMs > tokensStat.mtimeMs : false;
          update({
            step: 'token-reuse-gate',
            tokensPath: existingTokensPath,
            tokenSourceChanged: sourceChanged,
          });
        } catch {
          // No existing tokens — need LLM to generate
          if (await runAgentAuthCheck('generating-tokens')) {
            void runGenerateTokens(state.rawTokensPath, state.outDir);
          }
        }
      })();
    }
  }, [state.step]); // intentional: only re-run when step changes

  // Push-from-picker entry: on mount, dispatch runPreview to jump through
  // previewing → preview-gate → pushing → done. We DON'T wait for the
  // operator to interact with any pre-preview screen; the run-picker Push
  // action is a "click Push and watch it happen" flow. `preview-gate` still
  // renders after runPreview resolves — that's the diff-review screen where
  // the operator can confirm/quit/edit. We route straight past
  // push-decision-gate (which is for save-vs-push decisions on a fresh run).
  const pushFromPickerDispatched = useRef(false);
  useEffect(() => {
    if (state.step !== 'push-from-picker') return;
    if (pushFromPickerDispatched.current) return;
    pushFromPickerDispatched.current = true;
    void runPreview(
      state.extractSessionId,
      state.tokensPath,
      state.spaceId,
      state.environmentId,
      state.cmaToken,
      state.host,
    );
  }, [state.step]);

  // ── Render ────────────────────────────────────────────────────────────────────────────

  const noQuitSteps: WizardStep[] = [
    'run-picker',
    'checking-claude-auth',
    'validating-credentials',
    'generating-tokens',
    'extracting',
    'generating',
    'printing',
    'previewing',
    'push-from-picker',
    'pushing',
  ];
  const hints = noQuitSteps.includes(state.step) ? [] : [{ key: 'q', label: 'quit' }];

  // step count: tokens step adds 1, components steps add 2 (extract + generate)
  const hasTokens = !!state.tokensPath;
  const hasComponents = !state.skipComponents;
  const totalSteps = 3 + (hasTokens ? 1 : 0) + (hasComponents ? 2 : 0);

  const stepContent = (() => {
    switch (state.step) {
      case 'run-picker':
        return (
          <RunPicker
            runs={initialRuns ?? []}
            onSelect={(selection) => {
              if (selection.action === 'new') {
                update({ step: 'welcome' });
                return;
              }
              // Push / modify routing exits the wizard back into the CLI
              // surface so `replayRun` / `modifyRun` (which spin their own
              // UI / spawn their own Ink trees) can take over. The CLI
              // entry point in `command.ts` provides `onRunPicked`.
              onRunPicked?.(selection);
            }}
            onCancel={() => process.exit(0)}
          />
        );

      case 'welcome':
        return (
          <WelcomeStep
            onContinue={(path) => {
              const projectPath = normalizePath(path);
              const outDir = join(projectPath, '.contentful');
              update({ step: 'token-input', projectPath, outDir });
            }}
            onQuit={() => process.exit(0)}
          />
        );

      case 'token-input':
        return (
          <TokenInputStep
            onConfirm={(rawTokensPath) => {
              update({ rawTokensPath, step: 'generating-tokens' });
            }}
            onSkip={() => update({ step: 'path-validation' })}
            onQuit={() => process.exit(0)}
          />
        );

      case 'token-reuse-gate':
        return (
          <GateStep
            successMessage="Existing tokens.json found"
            summary={
              state.tokenSourceChanged
                ? `Source file has been modified since tokens were last generated.\n  ${state.tokensPath}`
                : `Source file has not changed since tokens were last generated.\n  ${state.tokensPath}`
            }
            context={
              state.tokenSourceChanged
                ? 'The source tokens file changed — regenerating is recommended.'
                : 'No changes detected — reusing the existing tokens avoids nondeterministic AI drift.'
            }
            continueLabel="Reuse existing tokens"
            skipLabel="Regenerate tokens"
            showSkip={true}
            onContinue={() => update({ step: 'path-validation', tokenSessionId: null })}
            onSkip={async () => {
              update({ tokenSourceChanged: null });
              if (await runAgentAuthCheck('generating-tokens')) {
                void runGenerateTokens(state.rawTokensPath, state.outDir);
              }
            }}
            onQuit={() => process.exit(0)}
          />
        );

      case 'checking-claude-auth':
        return (
          <RunningStep
            stepNumber={state.authCheckStepNumber}
            totalSteps={totalSteps}
            title={`Checking ${state.agent}`}
            description={`Verifying ${state.agent} is installed and authenticated...`}
          />
        );

      case 'generating-tokens':
        return (
          <RunningStep
            stepNumber={1}
            totalSteps={totalSteps}
            title="Generating token definitions"
            description={`${state.agent} is mapping your design tokens to DTCG format and writing tokens.json. This may take a few minutes.`}
          />
        );

      case 'path-validation':
        return (
          <PathValidationStep
            projectPath={state.projectPath}
            onConfirm={(path) => {
              void runExtract(path);
            }}
            onSkipComponents={() => {
              // No components — only design tokens to push. Still gather creds
              // first (unless --no-push, in which case there is nothing to do
              // and we save files instead).
              if (noPush) {
                update({ skipComponents: true, acceptedCount: 0 });
                void startSaveFlow();
                return;
              }
              update({ step: 'credentials', skipComponents: true, acceptedCount: 0 });
            }}
            onChangePath={() => update({ step: 'welcome' })}
            onQuit={() => process.exit(0)}
          />
        );

      case 'extracting': {
        const ep = state.extractProgress;
        let extractDetail: string;
        if (ep && ep.totalFiles > 0) {
          extractDetail = `Analyzing ${ep.filesProcessed}/${ep.totalFiles} files · ${ep.componentsFound} component${ep.componentsFound === 1 ? '' : 's'} found`;
        } else if (ep && ep.scanned > 0) {
          extractDetail = `Scanned ${ep.scanned} file${ep.scanned === 1 ? '' : 's'}...`;
        } else {
          extractDetail = 'Scanning...';
        }
        return (
          <RunningStep
            stepNumber={hasTokens ? 2 : 1}
            totalSteps={totalSteps}
            title="Extracting components"
            description="I'm scanning your files and figuring out what components exist, what props they have, and how they're structured. This is fully automatic — sit tight."
            detail={extractDetail}
          />
        );
      }

      case 'scope-gate': {
        if (!state.extractSessionId) {
          return (
            <Box paddingX={2} paddingY={1}>
              <Text color="red">Error: extract session ID missing — please re-run.</Text>
            </Box>
          );
        }
        const sessionId = state.extractSessionId;
        const db = openPipelineDb();
        let components: ScopeComponent[];
        try {
          components = loadScopeComponents(db, sessionId);
        } finally {
          db.close();
        }
        // INTEG-4318: overlay the streamed auto-filter decisions (from
        // stderr progress lines) onto DB-loaded rows so 'failed' components
        // (LLM omitted a tool call in a batch) surface in the scope-gate
        // instead of silently defaulting to included.
        components = mergeAiDecisions(components, state.aiDecisions);
        return (
          <ScopeGateHost
            components={components}
            autoAccept={autoAcceptScope}
            aiFilterStatus={state.aiFilterStatus}
            aiFilterProgress={state.aiFilterProgress}
            aiFilterError={state.aiFilterError}
            onCancelAutoFilter={cancelAutoFilter}
            onConfirm={(decisions) => {
              void runScopeGate({
                sessionId,
                decisions,
                cancelAutoFilter: state.aiFilterStatus === 'running' ? cancelAutoFilterAndWait : undefined,
                onAdvanceToGenerate: async ({ sessionId: sid, acceptedCount }) => {
                  update({ acceptedCount, autoRejectedCount: 0 });
                  const next = nextStepAfterScopeGate({ acceptedCount, noPush });
                  if (next === 'generating') {
                    if (await runAgentAuthCheck('generating')) {
                      void runGenerate(sid, state.tokensPath, acceptedCount);
                    }
                    return;
                  }
                  // next === 'credentials' (push enabled). Kick off the
                  // generate child in the background so the LLM call overlaps
                  // with the operator's credential entry. We only prefetch
                  // when we have accepted components to classify AND push is
                  // enabled (noPush path is already excluded — the scope-gate
                  // helper would have returned 'generating' there).
                  if (acceptedCount > 0 && !noPush) {
                    if (await runAgentAuthCheck('credentials')) {
                      startGeneratePrefetch(sid, state.tokensPath);
                    }
                  }
                  update({ step: 'credentials' });
                },
                onAdvanceToPushFlow: (count) => {
                  update({ acceptedCount: count, autoRejectedCount: 0 });
                  const next = nextStepAfterScopeGate({ acceptedCount: count, noPush });
                  if (next === 'print-gate') {
                    void startSaveFlow();
                    return;
                  }
                  // 'credentials' — still need creds for tokens/removals push.
                  advanceToPushFlow(count);
                },
              });
            }}
            onQuit={() => process.exit(0)}
          />
        );
      }

      case 'generating': {
        const p = state.generateProgress;
        const stepNum = hasTokens ? 4 : 3;
        const progressDetail = p
          ? `[${p.done}/${p.total}] ${p.current} — this can take 10–30 minutes for large libraries`
          : `Starting up ${state.agent}... (this can take 10–30 minutes for large libraries — grab a coffee)`;
        return (
          <RunningStep
            stepNumber={stepNum}
            totalSteps={totalSteps}
            title="Generating definitions"
            description={`${formatAcceptanceSummary({ accepted: state.acceptedCount, autoRejected: state.autoRejectedCount })} ${state.agent} is mapping your TypeScript types to Contentful's CDF format.${hasTokens ? ' Using your design tokens for prop resolution.' : ''}`}
            detail={progressDetail}
          />
        );
      }

      case 'final-review': {
        return (
          <FinalReviewHost
            extractSessionId={state.extractSessionId}
            generatedCount={state.generatedCount}
            autoAccept={autoAcceptScope}
            livePreview={livePreview}
            spaceId={state.spaceId}
            environmentId={state.environmentId}
            cmaToken={state.cmaToken}
            host={state.host}
            tokensPath={state.tokensPath}
            initialFinalizeError={state.finalizeErrorBanner}
            onFinalize={(accepted, rejected, unresolved) => {
              process.stderr.write(`Accepted: ${accepted}  Rejected: ${rejected}  Unresolved: ${unresolved}\n`);
              // INTEG-4411 refined: no `accepted === 0` up-front block here.
              // A zero-accepted finalize can still be a valid push when the
              // operator explicitly rejected component(s) that exist server-
              // side (→ REMOVALS) or when tokens carry a diff. The load-
              // bearing no-op check consults the preview response inside
              // `runPreview` below (see `isEmptyPreview` branch) and routes
              // back to `final-review` with `finalizeErrorBanner` set when
              // the diff is truly empty.
              if (noPush) {
                update({ generatedAcceptedCount: accepted });
                void startSaveFlow();
                return;
              }
              if (noSave) {
                update({ generatedAcceptedCount: accepted });
                const { extractSessionId, tokensPath } = sessionRef.current;
                void runPreview(
                  extractSessionId,
                  tokensPath,
                  state.spaceId,
                  state.environmentId,
                  state.cmaToken,
                  state.host,
                );
                return;
              }
              if (autoAcceptScope) {
                // Headless run with neither --no-save nor --no-push: pick the
                // default "both" path automatically to preserve scripted
                // (auto-accept-scope) UX from before the gate gained a third
                // option. Operators who want push-only must pass --no-save.
                update({ generatedAcceptedCount: accepted });
                void runSaveAndPush();
                return;
              }
              update({ generatedAcceptedCount: accepted, step: 'push-decision-gate' });
            }}
            onQuit={() => process.exit(0)}
          />
        );
      }

      case 'push-decision-gate': {
        const tokenDesc = hasTokens ? 'tokens.json' : null;
        const compDesc = hasComponents ? 'components.json' : null;
        const files = [tokenDesc, compDesc].filter(Boolean).join(' and ');
        const count = state.generatedAcceptedCount > 0 ? state.generatedAcceptedCount : state.generatedCount;
        const summary = hasComponents
          ? `${count} component definition${count !== 1 ? 's' : ''} ready${hasTokens ? ', design tokens ready' : ''}.`
          : hasTokens
            ? 'Design tokens ready.'
            : 'Ready to continue.';
        return (
          <PushDecisionGateStep
            summary={summary}
            context={`Save ${files || 'output files'} to disk, push to your Contentful space, or both.`}
            fileList={files || 'files'}
            pushDisabled={state.credentialsSkipped}
            onChoice={(choice) => {
              const action = chooseGateAction(choice);
              if (action === 'save-and-push') {
                void runSaveAndPush();
                return;
              }
              if (action === 'push-only') {
                const { extractSessionId, tokensPath } = sessionRef.current;
                void runPreview(
                  extractSessionId,
                  tokensPath,
                  state.spaceId,
                  state.environmentId,
                  state.cmaToken,
                  state.host,
                );
                return;
              }
              // save-only
              void startSaveFlow();
            }}
            onQuit={() => process.exit(0)}
          />
        );
      }

      case 'credentials':
        return (
          <CredentialsStep
            initialSpaceId={state.spaceId}
            initialEnvironmentId={state.environmentId}
            initialCmaToken={state.cmaToken}
            initialHost={state.host}
            error={state.credentialsError || undefined}
            validating={state.credentialsValidating}
            generatePrefetchStatus={state.generatePrefetchStatus}
            generatePrefetchError={state.generatePrefetchError}
            onConfirm={(spaceId, environmentId, cmaToken, host) => {
              void confirmCredentials(spaceId, environmentId, cmaToken, host);
            }}
            // INTEG-4410: unify the unchanged-form path with the changed-form
            // path so credentials are ALWAYS persisted to disk on submit.
            // The pre-fix wiring routed `onContinue` at
            // `advanceWithCredentials`, which only mutated state — so on
            // `--modify` (where the wizard seeds `run.pushedTo` into the
            // form, not disk) an operator pressing Enter never wrote to
            // ~/.config/experiences/credentials.json and disk stayed stale.
            onContinue={(spaceId, environmentId, cmaToken, host) => {
              void confirmCredentials(spaceId, environmentId, cmaToken, host);
            }}
            onRetryPrefetch={
              state.generatePrefetchStatus === 'failed' && sessionRef.current.extractSessionId
                ? () => {
                    const sid = sessionRef.current.extractSessionId!;
                    void startGeneratePrefetch(sid, state.tokensPath);
                  }
                : undefined
            }
            onSkip={() => {
              // Skip-credentials: mark the wizard as skipped, clear any
              // stale credentialsError banner, and advance through the
              // normal post-credentials branch. The in-flight generate
              // prefetch (PR #54) is intentionally NOT cancelled here —
              // the operator still wants to see classifications.
              update({ credentialsSkipped: true, credentialsError: '' });
              void advanceAfterCredentialsValidated();
            }}
            onQuit={() => {
              cancelGeneratePrefetch();
              process.exit(0);
            }}
          />
        );

      // 'credential-test-gate' is intentionally NOT rendered as a dedicated
      // screen any more (the post-#54 inline credentials-validating status made
      // the gate redundant). The step value is kept in the union for back-compat
      // with existing imports/tests but is never actually set as a step —
      // `advanceWithCredentials` calls `validateCredentials` directly.
      //
      // 'validating-credentials' is intentionally NOT rendered as a dedicated
      // screen any more (see CredentialsStep `validating` prop). The step
      // value is kept in the union for back-compat with existing imports/tests
      // but should never actually be set — `validateCredentials` keeps the
      // step on 'credentials' and toggles `credentialsValidating` instead.

      case 'push-from-picker':
      case 'previewing':
        return (
          <RunningStep
            stepNumber={totalSteps}
            totalSteps={totalSteps}
            title="Computing diff"
            description="Computing diff against your Contentful space..."
          />
        );

      case 'preview-gate':
        return (
          <WizardPreviewStep
            preview={state.serverPreview!}
            spaceId={state.spaceId}
            environmentId={state.environmentId}
            stepNumber={totalSteps}
            totalSteps={totalSteps}
            onConfirm={(acknowledge) => {
              void runPush(
                state.manifest!,
                state.spaceId,
                state.environmentId,
                state.cmaToken,
                state.host,
                acknowledge,
                state.serverPreview,
              );
            }}
            onEdit={() => {
              void runEditFromPreview();
            }}
            onSaveFiles={() => {
              void startSaveFlow();
            }}
            onQuit={() => process.exit(0)}
          />
        );

      case 'pushing':
        return (
          <PushingStep
            stepNumber={totalSteps}
            totalSteps={totalSteps}
            progress={state.pushProgress}
          />
        );

      case 'path-prompt':
        return (
          <PathPrompt
            defaultPath={state.outDir}
            onSubmit={(submitted) => {
              void (async () => {
                await mkdir(submitted, { recursive: true });
                const hasConflict = await detectSaveConflict(submitted);
                if (hasConflict) {
                  setState((prev) => ({ ...prev, step: 'save-conflict-gate', outDir: submitted }));
                  return;
                }
                await proceedToWrite(submitted);
              })();
            }}
            onCancel={() => process.exit(0)}
          />
        );

      case 'save-conflict-gate':
        return (
          <SaveConflictGate
            path={state.outDir}
            onOverwrite={() => {
              void proceedToWrite(state.outDir);
            }}
            onNew={() => {
              const subdir = buildTimestampedSubdir(state.outDir);
              void (async () => {
                await mkdir(subdir, { recursive: true });
                await proceedToWrite(subdir);
              })();
            }}
            onCancel={() => setState((prev) => ({ ...prev, step: 'path-prompt' }))}
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
            summary={[
              hasComponents && state.componentsPath ? `components.json → ${state.componentsPath}` : null,
              hasTokens && state.tokensPath ? `tokens.json → ${state.tokensPath}` : null,
            ]
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
        const teaser = buildRunTeaserLine(state.lastRunId);
        return (
          <DoneStep
            componentTypes={state.pushResult.componentTypes}
            designTokens={state.pushResult.designTokens}
            summary={state.pushResult.summary}
            spaceId={state.spaceId}
            environmentId={state.environmentId}
            host={state.host}
            {...(teaser ? { runTeaser: teaser } : {})}
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
            onRetryCredentials={
              state.errorAllowCredentialRetry ? () => update({ step: 'credentials', credentialsError: '' }) : undefined
            }
          />
        );

      // 'validating-credentials' kept in the WizardStep union for back-compat
      // but is no longer reachable as a step (validateCredentials toggles the
      // `credentialsValidating` boolean while leaving step on 'credentials').
      // Default-return null so the switch is exhaustive.
      default:
        return null;
    }
  })();

  return (
    <Box flexDirection="column" width={terminalWidth}>
      <TopBar subcommand="import" hints={hints} />
      <CustomPromptBanner selectPromptPath={selectPromptPath} generatePromptPath={generatePromptPath} />
      {stepContent}
    </Box>
  );
}
