import React, { useEffect, useRef, useState } from 'react';
import { PALETTE } from '../../analyze/select/tui/theme.js';
import { Box, Text } from 'ink';
import { join, resolve } from 'node:path';
import { appendFileSync, writeFileSync } from 'node:fs';
import { access, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { buildRunTeaserLine } from './run-teaser.js';
import { getDebugLogger } from '../../lib/debug-logger.js';
import { readExperiencesCredentials, writeExperiencesCredentials } from '../../credentials-store.js';
import { PathPrompt } from '../../runs/path-prompt.js';
import { detectSaveConflict, buildTimestampedSubdir } from '../../runs/save-path-resolver.js';
import { appendRun, updateRun } from '../../runs/store.js';
import { buildSourceFingerprint } from '../../runs/fingerprint.js';
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
import { parseGenerateStderrChunk, type GenerateProgressState } from './wizard-generate-progress.js';
import { spawnGenerateChild } from './spawn-generate.js';
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
  loadScopeComponents,
  loadDTCGTokens,
  copyTokensFromCache,
  storeDTCGTokens,
  seedCDFFromPreviewResponse,
  seedDefaultsFromChangedItems,
  backfillUnclassifiedProps,
} from '../../session/db.js';
import { ScopeGateStep, type ScopeComponent } from './steps/ScopeGateStep.js';
import { GenerateReviewStep } from './steps/GenerateReviewStep.js';
import { runScopeGate } from './runScopeGate.js';
import { checkAgentAuth, type AgentAuthStatus, type AgentName } from '@contentful/experience-design-system-generation';
import { normalizePath } from '../path-utils.js';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../../host-utils.js';
import { fetchAndPersistExistingContentfulEntities } from '../../helpers/fetch-and-persist-existing-contentful-entities.js';
import {
  shouldGenerateAfterScopeGate,
  shouldGenerateAfterCredentialsValidated,
  shouldBypassPreview,
  buildSkippedPreviewTransition,
  shouldRefusePush,
  buildSkippedPushTransition,
  shouldSkipFinalReviewAfterCredentials,
  resolveNoCacheForGenerate,
  resolveCycleGateAction,
} from './wizard-state-transitions.js';
import { findCliPath } from '../../lib/cli-path.js';
import { parsePromptOverrides, resolvePromptOverride } from '../../lib/prompt-overrides.js';
import { runSelectionAgent } from './run-selection-agent.js';
import { useTerminalSize } from '../../tui/use-terminal-size.js';
import { useScreenTransitionClear } from '../../tui/render-with-goodbye.js';

const SAVE_CONFIRMATION_DELAY_MS = 1000;

type WizardStep =
  | 'welcome'
  | 'token-input'
  | 'token-reuse-gate'
  | 'checking-claude-auth'
  | 'credential-test-gate'
  | 'validating-credentials'
  | 'path-validation'
  | 'extracting'
  | 'scope-gate'
  | 'generating'
  | 'mapping-tokens'
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
  componentTypes: { created: number; updated: number; removed: number; failed: number };
  designTokens: { created: number; updated: number; removed: number; failed: number };
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
  tokenSourceChanged: boolean | null;
  skipComponents: boolean;
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
  extractProgress: {
    scanned: number;
    filesProcessed: number;
    totalFiles: number;
    componentsFound: number;
  } | null;
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
  generatePrefetchStatus: 'idle' | 'running' | 'complete' | 'failed';
  generatePrefetchError: string | null;
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

export function buildGenerateComponentsArgs(opts: {
  sessionId: string;
  tokensPath?: string;
  agent: string;
  model?: string;
  bedrock?: boolean;
  noCache?: boolean;
  generatePromptPath?: string;
  promptOverrides?: string[];
  existingEntitiesPath?: string;
  restoreCache?: boolean;
  cachedComponents?: string[];
}): string[] {
  const args = ['__generate', 'components', '--agent', opts.agent, '--session', opts.sessionId];
  if (opts.tokensPath) args.push('--tokens', opts.tokensPath);
  if (opts.model) args.push('--model', opts.model);
  if (opts.bedrock) args.push('--bedrock');
  if (opts.noCache) args.push('--no-cache');
  if (opts.generatePromptPath) args.push('--generate-prompt-path', opts.generatePromptPath);
  for (const prompt of opts.promptOverrides ?? []) args.push('--prompt', prompt);
  if (opts.existingEntitiesPath) args.push('--existing-entities-path', opts.existingEntitiesPath);
  if (opts.restoreCache) args.push('--restore-cache');
  if (opts.cachedComponents && opts.cachedComponents.length > 0) {
    args.push('--cached-components', JSON.stringify(opts.cachedComponents));
  }
  return args;
}

export function buildGenerateTokensArgs(opts: {
  rawTokensPath: string;
  agent: string;
  model?: string;
  bedrock?: boolean;
  noCache?: boolean;
  promptOverrides?: string[];
}): string[] {
  const args = [findCliPath(), '__generate', 'tokens', '--agent', opts.agent, '--raw-tokens', opts.rawTokensPath];
  if (opts.model) args.push('--model', opts.model);
  if (opts.bedrock) args.push('--bedrock');
  if (opts.noCache) args.push('--no-cache');
  for (const prompt of opts.promptOverrides ?? []) args.push('--prompt', prompt);
  return args;
}

export function buildMapTokensArgs(opts: {
  sessionId: string;
  agent: string;
  model?: string;
  noCache?: boolean;
  skipAgent?: boolean;
  promptOverrides?: string[];
  existingEntitiesPath?: string;
}): string[] {
  const args = ['map', 'tokens', '--session', opts.sessionId, '--agent', opts.agent];
  if (opts.model) args.push('--model', opts.model);
  if (opts.noCache) args.push('--no-cache');
  if (opts.skipAgent) args.push('--skip-agent');
  for (const prompt of opts.promptOverrides ?? []) args.push('--prompt', prompt);
  if (opts.existingEntitiesPath) args.push('--existing-entities-path', opts.existingEntitiesPath);
  return args;
}

export function shouldRunMapTokens(opts: { mappablePropCount: number; rawTokenCount: number }): boolean {
  return opts.mappablePropCount > 0 && opts.rawTokenCount > 0;
}

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

type SpawnedCliResult = { exitCode: number; stdout: string; stderr: string };

function runSpawnedCli(
  args: string[],
  onStderr?: (chunk: string) => void,
  onStdout?: (chunk: string) => void,
): Promise<SpawnedCliResult> {
  return new Promise((res) => {
    const child = spawn('node', args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      const chunk = String(d);
      stdout += chunk;
      onStdout?.(chunk);
    });
    child.stderr.on('data', (d: Buffer) => {
      const chunk = String(d);
      stderr += chunk;
      onStderr?.(chunk);
    });
    child.on('exit', (code) => res({ exitCode: code ?? 0, stdout, stderr }));
  });
}

function buildGenerateProcessArgs(opts: Parameters<typeof buildGenerateComponentsArgs>[0]): string[] {
  return [findCliPath(), ...buildGenerateComponentsArgs(opts)];
}

function parseGenerateResult(
  result: Pick<SpawnedCliResult, 'stdout' | 'stderr'>,
  fallbackCount: number,
): {
  generateSessionId: string | null;
  generatedCount: number;
  renamedSlotsCount: number;
} {
  const sessionMatch = /^session=(.+)$/m.exec(result.stdout);
  const countMatch = /(\d+) components?/.exec(result.stderr);
  const renamedMatch = /^renamed-slots:\s*(\d+)$/m.exec(result.stdout);
  return {
    generateSessionId: sessionMatch ? sessionMatch[1]!.trim() : null,
    generatedCount: countMatch ? Number(countMatch[1]) : fallbackCount,
    renamedSlotsCount: renamedMatch ? Number(renamedMatch[1]) : 0,
  };
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

function startWizardTimer(name: string, payload: Record<string, unknown> = {}): number {
  const startedAt = Date.now();
  getDebugLogger().event('wizard', `${name}.start`, payload);
  return startedAt;
}

function finishWizardTimer(name: string, startedAt: number, payload: Record<string, unknown> = {}): void {
  getDebugLogger().event('wizard', `${name}.complete`, {
    ...payload,
    durationMs: Date.now() - startedAt,
  });
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
  promptOverrides?: string[];
  noCache?: boolean;
  livePreview?: boolean;
  generatePromptPath?: string;
  skipMapTokens?: boolean;
  initialRawTokensPath?: string;
  initialAgentAuth?: Promise<AgentAuthStatus>;
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
  promptOverrides,
  noCache = false,
  livePreview = true,
  generatePromptPath,
  skipMapTokens = false,
  initialRawTokensPath,
  initialAgentAuth,
}: WizardAppProps = {}): React.ReactElement {
  const defaultConfiguredHost = toConfiguredHost(host || process.env['EDS_HOST']) ?? DEFAULT_CONFIGURED_HOST;
  const resolveWizardHost = (hostValue?: string): string => hostValue || defaultConfiguredHost;
  const credentialKey = (spaceId: string, environmentId: string, cmaToken: string, hostValue: string): string =>
    [spaceId.trim(), environmentId.trim(), cmaToken.trim(), resolveWizardHost(hostValue)].join('\u0000');
  const { columns: terminalWidth } = useTerminalSize();
  const clearScreenOnTransition = useScreenTransitionClear();
  const logInit = useRef(false);
  const initialAgentAuthRef = useRef<Promise<AgentAuthStatus> | null>(initialAgentAuth ?? null);
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

  const generateChildRef = useRef<import('node:child_process').ChildProcess | null>(null);
  const generationCachePreflightRef = useRef<{
    sessionId: string;
    promise: Promise<Set<string>>;
  } | null>(null);
  const selectionToReviewStartedAtRef = useRef<number | null>(null);
  const credentialsValidationIdRef = useRef(0);
  const pendingCredentialValidationRef = useRef<{
    key: string;
    promise: Promise<boolean>;
  } | null>(null);
  const validatedCredentialsKeyRef = useRef<string | null>(null);
  const tokenGenerationPromiseRef = useRef<Promise<boolean> | null>(null);
  const extractPromiseRef = useRef<Promise<void> | null>(null);
  const extractStartedRef = useRef(false);
  const credentialsReadyRef = useRef(false);
  const agentAuthVerifiedRef = useRef(false);
  const scopeGateCompletedRef = useRef(false);
  const scopeComponentsRef = useRef<{ sessionId: string; components: ScopeComponent[] } | null>(null);
  const existingEntitiesPromiseRef = useRef<Promise<boolean> | null>(null);
  const generatePromiseRef = useRef<Promise<{
    exitCode: number;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }> | null>(null);

  const rawTokensEntryReady = !!initialRawTokensPath;
  const effectiveNoCache = resolveNoCacheForGenerate({ cliNoCache: noCache });
  const initialStepResolved: WizardStep = rawTokensEntryReady
    ? initialProjectPath
      ? 'path-validation'
      : 'credentials'
    : initialProjectPath
      ? 'token-input'
      : 'welcome';
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
    tokenSourceChanged: null,
    skipComponents: false,
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
    extractProgress: null,
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
    generatePrefetchStatus: 'idle',
    generatePrefetchError: null,
    mapTokensEligible: null,
    credentialsSkipped: false,
    existingEntitiesPath: null,
    existingEntitiesStatus: 'idle',
    lastRunId: null,
    finalizeErrorBanner: null,
    finalReviewPassed: false,
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

  const finishSelectionToReviewTimer = (mode: 'cached' | 'generated' | 'error'): void => {
    const startedAt = selectionToReviewStartedAtRef.current;
    if (startedAt === null) return;
    selectionToReviewStartedAtRef.current = null;
    finishWizardTimer('selection-to-review', startedAt, { mode });
  };

  const runAgentAuthCheck = async (nextStep: WizardStep, deferStep = false): Promise<boolean> => {
    const timer = startWizardTimer('agent-auth-validation', {
      agent: state.agent,
      deferred: deferStep,
      nextStep,
    });
    if (agentAuthVerifiedRef.current) {
      finishWizardTimer('agent-auth-validation', timer, { status: 'already-verified' });
      if (!deferStep) update({ step: nextStep });
      return true;
    }
    const authCheckStepNumber = state.tokensPath ? 4 : 3;
    const prefetchedAuth = initialAgentAuthRef.current;
    initialAgentAuthRef.current = null;
    if (!prefetchedAuth && !deferStep) update({ step: 'checking-claude-auth', authCheckStepNumber });
    let status: AgentAuthStatus;
    try {
      status = await (prefetchedAuth ?? checkAgentAuth(state.agent as AgentName));
    } catch (error) {
      finishWizardTimer('agent-auth-validation', timer, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    finishWizardTimer('agent-auth-validation', timer, {
      status,
      prefetched: Boolean(prefetchedAuth),
    });
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
    agentAuthVerifiedRef.current = true;
    if (!deferStep) update({ step: nextStep });
    return true;
  };

  const runGenerateTokens = async (
    rawTokensPath: string,
    outDir: string,
    forceRegenerate = false,
  ): Promise<boolean> => {
    update({ tokenGenerationStatus: 'running' });
    const tokenArgs = buildGenerateTokensArgs({
      rawTokensPath,
      agent: state.agent,
      ...(state.agentModel ? { model: state.agentModel } : {}),
      ...(state.bedrock ? { bedrock: true } : {}),
      noCache: effectiveNoCache || forceRegenerate,
      promptOverrides,
    });
    const result = await runSpawnedCli(tokenArgs);
    if (result.exitCode !== 0) {
      update({
        step: 'error',
        tokenGenerationStatus: 'failed',
        errorStep: 'generate tokens',
        errorMessage: result.stderr.trim() || 'Unknown error',
      });
      return false;
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
        tokenGenerationStatus: 'failed',
        errorStep: 'print tokens',
        errorMessage: r.stderr.trim() || 'Unknown error',
      });
      return false;
    }
    const tokenCount = parsePrintTokensCount(r.stdout);
    if (!state.projectPath) {
      // No --project was ever provided (raw-tokens-only run) — there is no
      // directory to validate. Take the same branch PathValidationStep's
      // own "skip components" path takes.
      update({
        tokensPath,
        tokenSessionId,
        tokenCount,
        tokenGenerationStatus: 'complete',
        skipComponents: true,
        acceptedCount: 0,
        outDir: state.outDir || join(process.cwd(), '.contentful'),
      });
      update({ step: 'credentials' });
      return true;
    }
    update({ tokensPath, tokenSessionId, tokenCount, tokenGenerationStatus: 'complete' });
    return true;
  };

  const runMapTokens = async (sessionId: string, silent = false): Promise<boolean> => {
    const timer = startWizardTimer('token-mapping', {
      sessionId,
      silent,
      noCache: effectiveNoCache,
      skipAgent: skipMapTokens,
    });
    let mappablePropCount = 0;
    let rawTokenCount = 0;
    try {
      const db = openPipelineDb();
      try {
        // Raw-token generation happens before component extraction, so a
        // normal wizard run can have a separate token session. The map-tokens
        // command operates on one session; copy that token universe into the
        // generated-component session while leaving the recorded token session
        // intact for save/push.
        if (state.tokenSessionId && state.tokenSessionId !== sessionId) {
          copyTokensFromCache(db, state.tokenSessionId, sessionId);
        } else if (!state.tokenSessionId && state.tokensPath) {
          // Reusing an existing tokens.json has no token session to copy. The
          // map-tokens command consumes the session DB, so restore the saved
          // catalog into the generated session before checking eligibility.
          const tokens = await readTokensFromPath('tokens', state.tokensPath);
          storeDTCGTokens(db, sessionId, [], tokens);
        }
        const cdfEntries = loadCDFComponents(db, sessionId);
        mappablePropCount = cdfEntries.reduce(
          (count, { entry }) =>
            count +
            Object.values(entry.$properties).filter((prop) => prop.$type === 'token' && prop.$category === 'design')
              .length,
          0,
        );
        rawTokenCount = loadDTCGTokens(db, sessionId).tokens.length;
      } finally {
        db.close();
      }
    } catch (error) {
      update({
        step: 'error',
        errorStep: 'map tokens',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      finishWizardTimer('token-mapping', timer, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    if (!shouldRunMapTokens({ mappablePropCount, rawTokenCount })) {
      if (!silent) update({ mapTokensEligible: false, mapTokensStatus: 'complete' });
      finishWizardTimer('token-mapping', timer, {
        status: 'skipped',
        mappablePropCount,
        rawTokenCount,
      });
      return true;
    }

    if (!silent) update({ mapTokensEligible: true, mapTokensStatus: 'running', step: 'generating' });
    const args = buildMapTokensArgs({
      sessionId,
      agent: state.agent,
      ...(state.agentModel ? { model: state.agentModel } : {}),
      noCache: effectiveNoCache,
      skipAgent: skipMapTokens,
      promptOverrides,
      ...(state.existingEntitiesPath ? { existingEntitiesPath: state.existingEntitiesPath } : {}),
    });

    const result = await runCli(args);
    if (result.exitCode !== 0) {
      update({
        step: 'error',
        mapTokensStatus: 'failed',
        errorStep: 'map tokens',
        errorMessage: result.stderr.trim() || 'Unknown error',
      });
      finishWizardTimer('token-mapping', timer, {
        status: 'error',
        exitCode: result.exitCode,
        mappablePropCount,
        rawTokenCount,
      });
      return false;
    }

    // The command can still report "Nothing to map" if the database changes
    // between eligibility detection and subprocess startup. Treat that as a
    // successful no-op and continue to final review.
    if (!silent) update({ mapTokensStatus: 'complete' });
    finishWizardTimer('token-mapping', timer, {
      status: 'complete',
      exitCode: result.exitCode,
      mappablePropCount,
      rawTokenCount,
    });
    return true;
  };

  const startExistingEntitiesFetch = (projectPath: string, outDir: string): Promise<boolean> | null => {
    if (state.credentialsSkipped || !state.spaceId || !state.environmentId || !state.cmaToken || !projectPath) {
      return null;
    }
    const startedAt = Date.now();
    getDebugLogger().event('wizard', 'existing-entities.fetch.start', {
      spaceId: state.spaceId,
      environmentId: state.environmentId,
      host: state.host,
      outDir,
    });
    update({ existingEntitiesStatus: 'running' });
    const promise = (async (): Promise<boolean> => {
      try {
        await mkdir(outDir, { recursive: true });
        const result = await fetchAndPersistExistingContentfulEntities({
          spaceId: state.spaceId,
          environmentId: state.environmentId,
          cmaToken: state.cmaToken,
          ...(state.host ? { host: state.host } : {}),
          outDir,
        });
        if (result.ok) {
          getDebugLogger().event('wizard', 'existing-entities.fetch.ok', {
            durationMs: result.durationMs,
            components: result.entities.components.length,
            tokens: result.entities.tokens.length,
          });
          update({ existingEntitiesPath: result.path, existingEntitiesStatus: 'complete' });
          return true;
        }
        getDebugLogger().event('wizard', 'existing-entities.fetch.error', {
          durationMs: result.durationMs,
          error: result.error,
        });
        update({ existingEntitiesStatus: 'failed' });
        return false;
      } catch (error) {
        getDebugLogger().event('wizard', 'existing-entities.fetch.error', {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        update({ existingEntitiesStatus: 'failed' });
        return false;
      }
    })();
    existingEntitiesPromiseRef.current = promise;
    return promise;
  };

  const runExtract = async (projectPath: string, showProgress = true) => {
    const outDir = join(resolve(projectPath), '.contentful');
    const existingEntitiesExpected =
      !state.credentialsSkipped && Boolean(state.spaceId && state.environmentId && state.cmaToken && projectPath);
    update({
      ...(showProgress ? { step: 'extracting' as WizardStep } : {}),
      outDir,
      extractProgress: null,
      compositionPhase: 'resolving',
      // Put every extraction-stage task on the first frame. The selection
      // agent cannot start until extraction emits its session, but it is
      // already part of this stage and should not appear later as a new row.
      selectionAgentStatus: state.agent ? 'running' : 'complete',
      existingEntitiesStatus: existingEntitiesExpected ? 'running' : 'idle',
    });
    const existingEntitiesPromise = startExistingEntitiesFetch(projectPath, outDir);
    const extractArgs = [findCliPath(), '__extract', '--project', projectPath];
    if (effectiveNoCache) extractArgs.push('--composition-refresh', '--no-cache');
    for (const p of promptOverrides ?? []) extractArgs.push('--prompt', p);
    // Composition resolution uses the same agent the user picked for the run.
    if (state.agent) extractArgs.push('--agent', state.agent);
    if (state.bedrock) extractArgs.push('--bedrock');
    let selectionPromptText: string | undefined;
    let selectionPromptPath: string | undefined;
    try {
      const { overrides, errors } = parsePromptOverrides(promptOverrides ?? []);
      if (errors.length > 0) throw new Error(errors.join('; '));
      const selectOverride = overrides.get('select');
      if (selectOverride?.kind === 'text') selectionPromptText = selectOverride.value;
      if (selectOverride?.kind === 'path') {
        selectionPromptPath = resolve(selectOverride.value);
        await resolvePromptOverride(selectOverride);
      }
    } catch (error) {
      update({
        step: 'error',
        errorStep: 'selection agent',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let selectionPromise: Promise<void> | null = null;
    let selectionError: unknown;
    let selectionStarted = false;
    const startSelection = (sessionId: string): void => {
      if (selectionStarted || !state.agent) return;
      selectionStarted = true;
      selectionPromise = (async () => {
        if (existingEntitiesPromise) await existingEntitiesPromise;
        await runSelectionAgent({
          sessionId,
          agent: state.agent as AgentName,
          ...(state.agentModel ? { model: state.agentModel } : {}),
          ...(selectionPromptText !== undefined ? { promptText: selectionPromptText } : {}),
          ...(selectionPromptPath ? { promptPath: selectionPromptPath } : {}),
          noCache: effectiveNoCache,
        });
      })()
        .catch((error: unknown) => {
          selectionError = error;
        })
        .finally(() => update({ selectionAgentStatus: 'complete' }));
    };

    let stderrBuffer = '';
    let stdoutBuffer = '';
    const r = await runSpawnedCli(
      extractArgs,
      (chunk) => {
        stderrBuffer += chunk;
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
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
          const scanDoneMatch = /^progress=scan-done:(\d+)$/.exec(line.trim());
          if (scanDoneMatch) {
            const scanned = Number(scanDoneMatch[1]);
            setState((prev) => ({
              ...prev,
              extractProgress: {
                scanned,
                filesProcessed: prev.extractProgress?.filesProcessed ?? 0,
                totalFiles: scanned,
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
            continue;
          }
          const compositionMatch = /^progress=composition:(.+)$/.exec(line.trim());
          if (compositionMatch) {
            setState((prev) => ({ ...prev, compositionPhase: compositionMatch[1]!.trim() }));
          }
        }
      },
      (chunk) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const sessionMatch = /^session=(.+)$/.exec(line.trim());
          if (sessionMatch) startSelection(sessionMatch[1]!.trim());
        }
      },
    );
    const sessionMatch = /^session=(.+)$/m.exec(r.stdout);
    if (!selectionStarted && sessionMatch) startSelection(sessionMatch[1]!.trim());
    if (selectionPromise) await selectionPromise;
    if (!selectionStarted && existingEntitiesPromise) await existingEntitiesPromise;
    if (r.exitCode !== 0) {
      update({
        step: 'error',
        errorStep: 'analyze extract',
        errorMessage: r.stderr.trim() || 'Unknown error',
      });
      return;
    }
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
    if (selectionError) {
      update({
        step: 'error',
        errorStep: 'selection agent',
        errorMessage: selectionError instanceof Error ? selectionError.message : String(selectionError),
      });
      return;
    }
    if (state.rawTokensPath && tokenGenerationPromiseRef.current) {
      const tokenGenerationSucceeded = await tokenGenerationPromiseRef.current;
      tokenGenerationPromiseRef.current = null;
      if (!tokenGenerationSucceeded) return;
    }
    update({
      extractSessionId,
      selectionAgentStatus: 'complete',
      ...(credentialsReadyRef.current ? { step: 'scope-gate' as WizardStep } : {}),
    });
  };

  const startExtract = (projectPath: string, showProgress = true): void => {
    if (extractStartedRef.current) return;
    extractStartedRef.current = true;
    const promise = runExtract(projectPath, showProgress);
    extractPromiseRef.current = promise;
    void promise.finally(() => {
      extractPromiseRef.current = null;
    });
  };

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

  const buildGenerateOptions = (
    extractSessionId: string,
    tokensPath: string,
    generatePromptPath?: string,
    cachedComponents?: string[],
  ) => ({
    sessionId: extractSessionId,
    tokensPath,
    agent: state.agent,
    ...(state.agentModel ? { model: state.agentModel } : {}),
    ...(state.bedrock ? { bedrock: true } : {}),
    noCache: effectiveNoCache,
    ...(state.existingEntitiesPath ? { existingEntitiesPath: state.existingEntitiesPath } : {}),
    ...(generatePromptPath ? { generatePromptPath } : {}),
    promptOverrides,
    ...(cachedComponents && cachedComponents.length > 0 ? { cachedComponents } : {}),
  });

  const buildGenerateArgs = (
    extractSessionId: string,
    tokensPath: string,
    generatePromptPath?: string,
    cachedComponents?: string[],
  ): string[] =>
    buildGenerateProcessArgs(buildGenerateOptions(extractSessionId, tokensPath, generatePromptPath, cachedComponents));

  const buildGenerateCliArgs = (
    extractSessionId: string,
    tokensPath: string,
    generatePromptPath?: string,
    cachedComponents?: string[],
  ): string[] =>
    buildGenerateComponentsArgs(
      buildGenerateOptions(extractSessionId, tokensPath, generatePromptPath, cachedComponents),
    );

  const checkGenerateCache = async (extractSessionId: string, tokensPath: string): Promise<boolean> => {
    const timer = startWizardTimer('generation-cache-status', {
      sessionId: extractSessionId,
      noCache: effectiveNoCache,
    });
    if (effectiveNoCache) {
      finishWizardTimer('generation-cache-status', timer, { status: 'skipped' });
      return false;
    }
    const result = await runCli([...buildGenerateCliArgs(extractSessionId, tokensPath), '--cache-status']);
    const hit = result.exitCode === 0 && /^cache-status=hit$/m.test(result.stdout);
    finishWizardTimer('generation-cache-status', timer, {
      status: hit ? 'hit' : 'miss',
      exitCode: result.exitCode,
      ...(result.exitCode !== 0 ? { stderrTail: result.stderr.trim().slice(-500) } : {}),
    });
    return hit;
  };

  const checkGenerateCacheComponents = async (
    extractSessionId: string,
    tokensPath: string,
    restoreCache = false,
  ): Promise<Set<string>> => {
    const timer = startWizardTimer('generation-cache-components', {
      sessionId: extractSessionId,
      restoreCache,
      noCache: effectiveNoCache,
    });
    if (effectiveNoCache) {
      finishWizardTimer('generation-cache-components', timer, { status: 'skipped' });
      return new Set();
    }
    const args = [...buildGenerateCliArgs(extractSessionId, tokensPath), '--cache-status'];
    if (restoreCache) args.push('--restore-cache');
    const result = await runCli(args);
    if (result.exitCode !== 0) {
      finishWizardTimer('generation-cache-components', timer, {
        status: 'error',
        exitCode: result.exitCode,
        stderrTail: result.stderr.trim().slice(-500),
      });
      return new Set();
    }
    const line = /^cache-components=(.+)$/m.exec(result.stdout)?.[1];
    if (!line) {
      finishWizardTimer('generation-cache-components', timer, {
        status: 'missing-output',
        exitCode: result.exitCode,
        cachedCount: 0,
      });
      return new Set();
    }
    try {
      const names: unknown = JSON.parse(line);
      const cachedNames = new Set(
        Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [],
      );
      finishWizardTimer('generation-cache-components', timer, {
        status: 'complete',
        exitCode: result.exitCode,
        cachedCount: cachedNames.size,
      });
      return cachedNames;
    } catch {
      finishWizardTimer('generation-cache-components', timer, {
        status: 'invalid-output',
        exitCode: result.exitCode,
        cachedCount: 0,
      });
      return new Set();
    }
  };

  useEffect(() => {
    if (
      (state.step !== 'extracting' && state.step !== 'scope-gate') ||
      !state.extractSessionId ||
      state.existingEntitiesStatus === 'running' ||
      state.existingEntitiesStatus === 'idle' ||
      state.selectionAgentStatus !== 'complete' ||
      (state.compositionPhase !== 'done' && state.compositionPhase !== 'cache-hit') ||
      (state.rawTokensPath && state.tokenGenerationStatus !== 'complete') ||
      effectiveNoCache
    ) {
      return;
    }
    const sessionId = state.extractSessionId;
    if (generationCachePreflightRef.current?.sessionId === sessionId) return;
    const timer = startWizardTimer('generation-cache-preflight', { sessionId });
    const db = openPipelineDb();
    let generatedNames: Set<string> | null = null;
    try {
      const rows = db.prepare('SELECT name, status FROM raw_components WHERE session_id = ?').all(sessionId) as Array<{
        name: string;
        status: string;
      }>;
      if (rows.length > 0 && rows.every((row) => row.status === 'generated')) {
        generatedNames = new Set(rows.map((row) => row.name));
      }
    } finally {
      db.close();
    }
    if (generatedNames) {
      generationCachePreflightRef.current = { sessionId, promise: Promise.resolve(generatedNames) };
      finishWizardTimer('generation-cache-preflight', timer, {
        status: 'complete',
        source: 'session-db',
        cachedCount: generatedNames.size,
      });
      return;
    }
    const promise = checkGenerateCacheComponents(sessionId, state.tokensPath, true);
    generationCachePreflightRef.current = { sessionId, promise };
    void promise.then((cachedNames) => {
      finishWizardTimer('generation-cache-preflight', timer, {
        status: 'complete',
        source: 'cache-status',
        cachedCount: cachedNames.size,
      });
    });
  }, [
    state.step,
    state.extractSessionId,
    state.tokensPath,
    state.rawTokensPath,
    state.tokenGenerationStatus,
    state.selectionAgentStatus,
    state.compositionPhase,
    state.existingEntitiesStatus,
    state.existingEntitiesPath,
  ]);

  const startGeneratePrefetch = (
    extractSessionId: string,
    tokensPath: string,
  ): Promise<{
    exitCode: number;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }> => {
    const args = buildGenerateArgs(extractSessionId, tokensPath);
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
        generateChildRef.current = null;
        if (result.signal === 'SIGTERM') {
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
        const { generateSessionId, generatedCount } = parseGenerateResult(result, 0);
        setState((prev) => ({
          ...prev,
          generateSessionId,
          generatedCount,
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

  const runGenerate = async (
    extractSessionId: string,
    tokensPath: string,
    acceptedCount: number,
    suppressScreen = false,
    cachedComponents: string[] = [],
  ) => {
    const timer = startWizardTimer('component-generation', {
      sessionId: extractSessionId,
      acceptedCount,
      suppressScreen,
      noCache: effectiveNoCache,
    });
    const args = buildGenerateArgs(extractSessionId, tokensPath, generatePromptPath, cachedComponents);
    let progressCursor: GenerateProgressState = state.generateProgress;
    const { donePromise } = spawnGenerateChild({
      command: 'node',
      args,
      onStderr: (chunk) => {
        const nextProgress = parseGenerateStderrChunk(chunk, progressCursor);
        if (nextProgress !== progressCursor) {
          progressCursor = nextProgress;
          if (!suppressScreen) update({ generateProgress: nextProgress });
        }
      },
    });
    const result = await donePromise;

    if (result.exitCode !== 0) {
      finishWizardTimer('component-generation', timer, {
        status: 'error',
        exitCode: result.exitCode,
      });
      finishSelectionToReviewTimer('error');
      update({
        step: 'error',
        errorStep: 'generate components',
        errorMessage: result.stderr.trim() || 'Unknown error',
      });
      return;
    }
    const { generateSessionId, generatedCount, renamedSlotsCount } = parseGenerateResult(result, acceptedCount);
    const mappedSessionId = generateSessionId ?? extractSessionId;
    finishWizardTimer('component-generation', timer, {
      status: 'complete',
      exitCode: result.exitCode,
      generatedCount,
      renamedSlotsCount,
    });
    if (!suppressScreen) {
      update({
        acceptedCount,
        autoRejectedCount: 0,
        generateSessionId: mappedSessionId,
        generatedCount,
        generateProgress: null,
      });
      if (await runMapTokens(mappedSessionId)) {
        finishSelectionToReviewTimer('generated');
        update({ step: 'final-review' });
      } else {
        finishSelectionToReviewTimer('error');
      }
      return;
    }

    // The scope-gate path remains in place until generation and token mapping
    // finish, then transitions directly to the review screen in one render.
    const mapped = await runMapTokens(mappedSessionId, true);
    if (mapped) {
      finishSelectionToReviewTimer('generated');
      update(
        {
          acceptedCount,
          autoRejectedCount: 0,
          generateSessionId: mappedSessionId,
          generatedCount,
          generateProgress: null,
          mapTokensStatus: 'complete',
          step: 'final-review',
        },
        { clearScreen: false },
      );
    } else {
      finishSelectionToReviewTimer('error');
    }
  };

  const finishCachedGeneration = async (sessionId: string, acceptedCount: number): Promise<void> => {
    if (await runMapTokens(sessionId, true)) {
      finishSelectionToReviewTimer('cached');
      update(
        {
          acceptedCount,
          autoRejectedCount: 0,
          generateSessionId: sessionId,
          generatedCount: acceptedCount,
          generateProgress: null,
          mapTokensStatus: 'complete',
          step: 'final-review',
        },
        { clearScreen: false },
      );
    } else {
      finishSelectionToReviewTimer('error');
    }
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

  const advanceWithCredentials = async (spaceId: string, environmentId: string, cmaToken: string, host: string) => {
    const resolvedHost = resolveWizardHost(host);
    const key = credentialKey(spaceId, environmentId, cmaToken, resolvedHost);

    if (validatedCredentialsKeyRef.current === key) {
      await advanceAfterCredentialsValidated();
      return;
    }

    const pending = pendingCredentialValidationRef.current;
    if (pending?.key === key) {
      if (await pending.promise) await advanceAfterCredentialsValidated();
      return;
    }

    await validateCredentials(spaceId, environmentId, cmaToken, resolvedHost);
  };

  const confirmCredentials = async (spaceId: string, environmentId: string, cmaToken: string, host: string) => {
    const resolvedHost = resolveWizardHost(host);
    try {
      const stored = await readExperiencesCredentials();
      await writeExperiencesCredentials({
        ...stored,
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

  const validateCredentials = async (
    spaceId: string,
    environmentId: string,
    cmaToken: string,
    host: string,
    options: { background?: boolean; validationId?: number } = {},
  ): Promise<boolean> => {
    const validationId = options.validationId ?? ++credentialsValidationIdRef.current;
    const isCurrent = (): boolean => credentialsValidationIdRef.current === validationId;
    const key = credentialKey(spaceId, environmentId, cmaToken, host);
    update({
      step: 'credentials',
      credentialsValidating: true,
      credentialsBackgroundValidating: options.background === true,
      credentialsError: '',
    });
    try {
      const resolvedHost = resolveWizardHost(host);
      const client = new ImportApiClient({
        cmaToken,
        spaceId,
        environmentId,
        host: resolvedHost,
      });
      await client.validateToken();
      if (!isCurrent()) return false;
      validatedCredentialsKeyRef.current = key;
      update({
        spaceId,
        environmentId,
        cmaToken,
        host: resolvedHost,
        credentialsValidating: false,
        credentialsBackgroundValidating: false,
      });
      if (options.background) return true;
      await advanceAfterCredentialsValidated(validationId);
      return true;
    } catch (e) {
      if (!isCurrent()) return false;
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) {
        cancelGeneratePrefetch();
        update({
          step: 'credentials',
          credentialsValidating: false,
          credentialsBackgroundValidating: false,
          credentialsError: formatApiError(e, process.env['EDSI_VERBOSE_ERRORS'] === '1'),
        });
        return false;
      }
      const msg = e instanceof Error ? e.message : 'Credential check failed';
      cancelGeneratePrefetch();
      update({
        step: 'error',
        errorStep: 'validating-credentials',
        errorMessage: msg,
        errorAllowCredentialRetry: false,
        credentialsValidating: false,
        credentialsBackgroundValidating: false,
      });
      return false;
    }
  };

  const handleCredentialValuesChange = (): void => {
    credentialsValidationIdRef.current += 1;
    pendingCredentialValidationRef.current = null;
    validatedCredentialsKeyRef.current = null;
    if (state.credentialsValidating) {
      update({ credentialsValidating: false, credentialsBackgroundValidating: false, credentialsError: '' });
    }
  };

  useEffect(() => {
    if (state.step !== 'credentials' || state.credentialsSkipped) return;
    if (!state.spaceId.trim() || !state.environmentId.trim() || !state.cmaToken.trim()) return;

    const validationId = ++credentialsValidationIdRef.current;
    const key = credentialKey(state.spaceId, state.environmentId, state.cmaToken, state.host);
    const promise = validateCredentials(state.spaceId, state.environmentId, state.cmaToken, state.host, {
      background: true,
      validationId,
    });
    pendingCredentialValidationRef.current = { key, promise };
    void promise.then(
      () => {
        if (pendingCredentialValidationRef.current?.promise === promise) pendingCredentialValidationRef.current = null;
      },
      () => {
        if (pendingCredentialValidationRef.current?.promise === promise) pendingCredentialValidationRef.current = null;
      },
    );

    return () => {
      credentialsValidationIdRef.current += 1;
      pendingCredentialValidationRef.current = null;
    };
  }, [state.step]);

  const advanceAfterCredentialsValidated = async (validationId?: number) => {
    const isCurrent = (): boolean => validationId === undefined || credentialsValidationIdRef.current === validationId;
    if (!isCurrent()) return;
    if (!isCurrent()) return;
    credentialsReadyRef.current = true;
    // Under the front-of-flow ordering, credentials are collected right after
    // path-validation and before extract. When we get here without an extract
    // session, the user hasn't started the pipeline yet — kick it off.
    if (!sessionRef.current.extractSessionId && state.projectPath) {
      if (extractPromiseRef.current) update({ step: 'extracting' });
      else startExtract(state.projectPath);
      return;
    }
    if (!scopeGateCompletedRef.current && sessionRef.current.extractSessionId) {
      if (extractPromiseRef.current) update({ step: 'extracting' });
      else update({ step: 'scope-gate' });
      return;
    }
    if (
      shouldSkipFinalReviewAfterCredentials({
        generateSessionId: state.generateSessionId,
        finalReviewPassed: state.finalReviewPassed,
      })
    ) {
      void runSaveAndPush();
      return;
    }
    if (shouldGenerateAfterCredentialsValidated({ acceptedCount: state.acceptedCount })) {
      const sid = sessionRef.current.extractSessionId;
      if (!sid) {
        update({
          step: 'error',
          errorStep: 'post-credentials',
          errorMessage: 'Internal error: extract session ID missing after credential validation.',
        });
        return;
      }
      const inflight = generatePromiseRef.current;
      if (inflight) {
        update({ step: 'generating' });
        const result = await inflight;
        generatePromiseRef.current = null;
        if (result.exitCode === 0 && result.signal !== 'SIGTERM') {
          const sessionMatch = /^session=(.+)$/m.exec(result.stdout);
          const generatedSessionId = sessionMatch ? sessionMatch[1]!.trim() : sid;
          update({ generateSessionId: generatedSessionId });
          if (await runMapTokens(generatedSessionId)) update({ step: 'final-review' });
          return;
        }
      }
      if (await runAgentAuthCheck('generating', true)) {
        const cacheHit = await checkGenerateCache(sid, state.tokensPath);
        if (cacheHit) {
          update({ step: 'generating' });
          void finishCachedGeneration(sid, state.acceptedCount);
        } else {
          update({ step: 'generating' });
          void runGenerate(sid, state.tokensPath, state.acceptedCount);
        }
      }
      return;
    }
    void runSaveAndPush();
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
      let cdf = buildCDF(components, toCDFTokens(tokens), { deleteAll: allowEmptyDeleteAllRef.current })!;
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
            cdf = buildCDF(components, toCDFTokens(tokens), { deleteAll: allowEmptyDeleteAllRef.current })!;
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
          update({ step: 'credentials', credentialsError: e.message });
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

    update({ step: 'pushing', pushProgress: null, errorAllowBreakingChangeAcknowledgment: false });
    try {
      const resolvedHost = resolveWizardHost(host);
      const client = new ImportApiClient({
        cmaToken,
        spaceId,
        environmentId,
        host: resolvedHost,
      });
      let operation = await client.applyImport(cdf, { acknowledgeBreakingChanges });
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
    opts: { skipGate?: boolean; tokenSessionId?: string | null; tokensPath?: string; allowEmpty?: boolean } = {},
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

      const cdf = buildSavedCDF(components, tokens, { deleteAll: opts.allowEmpty });
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

  const pendingSaveOptionsRef = useRef<{ skipGate?: boolean; andPush?: boolean }>({});

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

  const tokenReuseChecked = useRef(false);
  useEffect(() => {
    if (state.rawTokensPath) {
      if (tokenReuseChecked.current) return; // already checked or user chose regenerate
      tokenReuseChecked.current = true;
      const tokenNextStep: WizardStep = state.projectPath ? 'path-validation' : 'credentials';
      const existingTokensPath = join(state.outDir, 'tokens.json');
      if (effectiveNoCache) {
        tokenGenerationPromiseRef.current = runAgentAuthCheck(tokenNextStep).then((ok) =>
          ok ? runGenerateTokens(state.rawTokensPath, state.outDir) : false,
        );
        return;
      }
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
          tokenGenerationPromiseRef.current = runAgentAuthCheck(tokenNextStep).then((ok) =>
            ok ? runGenerateTokens(state.rawTokensPath, state.outDir) : false,
          );
        }
      })();
    }
  }, [state.rawTokensPath]);

  const noQuitSteps: WizardStep[] = [
    'checking-claude-auth',
    'validating-credentials',
    'extracting',
    'generating',
    'mapping-tokens',
    'printing',
    'previewing',
    'pushing',
  ];
  const hints = noQuitSteps.includes(state.step) ? [] : [{ key: 'q', label: 'quit' }];

  const hasTokens = !!state.tokensPath;
  const hasTokenStage = hasTokens || !!state.rawTokensPath;
  const hasComponents = !state.skipComponents;
  const totalSteps = 3 + (hasTokenStage ? 1 : 0) + (hasComponents ? 2 : 0) + (state.mapTokensEligible === true ? 1 : 0);

  const stepContent = (() => {
    switch (state.step) {
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
              update({ rawTokensPath, step: 'path-validation', tokenGenerationStatus: 'idle' });
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
                ? `Source file has been modified since tokens were last generated.\n\nTokens Path: ${state.tokensPath}`
                : `Source file has not changed since tokens were last generated.\n\nTokens Path: ${state.tokensPath}`
            }
            context={
              state.tokenSourceChanged ? 'The source tokens file changed — regenerating is recommended.' : undefined
            }
            continueLabel="Reuse existing tokens"
            skipLabel="Regenerate tokens"
            showSkip={true}
            onContinue={() =>
              update({
                step: state.projectPath ? 'path-validation' : 'credentials',
                tokenSessionId: null,
                tokenGenerationStatus: 'complete',
              })
            }
            onSkip={async () => {
              update({ tokenSourceChanged: null });
              const tokenNextStep: WizardStep = state.projectPath ? 'path-validation' : 'credentials';
              update({ step: tokenNextStep });
              if (await runAgentAuthCheck(tokenNextStep)) {
                tokenGenerationPromiseRef.current = runGenerateTokens(state.rawTokensPath, state.outDir, true);
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

      case 'path-validation':
        return (
          <PathValidationStep
            projectPath={state.projectPath}
            onConfirm={(path) => {
              update({ projectPath: path, step: 'credentials' });
              startExtract(path, false);
            }}
            onSkipComponents={() => {
              update({ step: 'credentials', skipComponents: true, acceptedCount: 0 });
            }}
            onChangePath={() => update({ step: 'welcome' })}
            onQuit={() => process.exit(0)}
          />
        );

      case 'extracting': {
        const ep = state.extractProgress;
        const compositionComplete = state.compositionPhase === 'done' || state.compositionPhase === 'cache-hit';
        const tokenGenerationComplete = !state.rawTokensPath || state.tokenGenerationStatus === 'complete';
        const extractionTasksComplete =
          ep !== null &&
          ep.totalFiles > 0 &&
          compositionComplete &&
          state.selectionAgentStatus === 'complete' &&
          tokenGenerationComplete &&
          state.existingEntitiesStatus !== 'running';

        // Once extraction, composition, and selection are all cached, there is
        // no useful intermediate screen to show. Keep this screen only while
        // the existing-entity fetch is still doing work; it is intentionally
        // independent of the local pipeline caches.
        if (extractionTasksComplete) return null;

        let extractDetail: string;
        let extractComplete = false;
        if (ep && ep.totalFiles > 0) {
          extractDetail = `Scanned ${ep.scanned} file${ep.scanned === 1 ? '' : 's'}`;
          extractComplete = true;
        } else if (ep) {
          extractDetail = `Scanning ${ep.scanned} file${ep.scanned === 1 ? '' : 's'}`;
        } else {
          extractDetail = 'Scanning files...';
        }
        const selectionDetail =
          state.selectionAgentStatus === 'complete'
            ? 'Selection agent complete'
            : `Filtering component selection via ${state.agent}...`;
        const compositionDetail =
          state.compositionPhase === 'cache-hit'
            ? 'Composition mapping (cached)'
            : compositionComplete
              ? 'Composition mapping complete'
              : state.compositionPhase?.startsWith('agent:')
                ? `Mapping composition via ${state.compositionPhase.slice('agent:'.length)}...`
                : `Mapping composition via ${state.agent}...`;
        return (
          <RunningStep
            stepNumber={hasTokenStage ? 2 : 1}
            totalSteps={totalSteps}
            title="Extracting context"
            description="Extracting context from your source files."
            detail={extractDetail}
            detailComplete={extractComplete}
            secondaryDetail={compositionDetail}
            secondaryComplete={compositionComplete}
            tertiaryDetail={selectionDetail}
            tertiaryComplete={state.selectionAgentStatus === 'complete'}
            quaternaryDetail={
              state.existingEntitiesStatus === 'running'
                ? 'Fetching existing components and tokens...'
                : state.existingEntitiesStatus === 'complete'
                  ? 'Existing components and tokens ready'
                  : state.existingEntitiesStatus === 'failed'
                    ? 'Existing entities unavailable; continuing without them'
                    : undefined
            }
            quaternaryComplete={
              state.existingEntitiesStatus === 'complete' || state.existingEntitiesStatus === 'failed'
            }
            quinaryDetail={
              state.rawTokensPath
                ? state.tokenGenerationStatus === 'running'
                  ? `Generating token definitions via ${state.agent}...`
                  : state.tokenGenerationStatus === 'complete'
                    ? 'Token definitions ready'
                    : state.tokenGenerationStatus === 'failed'
                      ? 'Token definition generation failed'
                      : `Generating token definitions via ${state.agent}...`
                : undefined
            }
            quinaryComplete={state.tokenGenerationStatus === 'complete'}
          />
        );
      }

      case 'scope-gate': {
        if (!state.extractSessionId) {
          return (
            <Box paddingX={2} paddingY={1}>
              <Text color={PALETTE.error}>Error: extract session ID missing — please re-run.</Text>
            </Box>
          );
        }
        const sessionId = state.extractSessionId;
        const db = openPipelineDb();
        let loadedComponents: ScopeComponent[];
        try {
          loadedComponents = loadScopeComponents(db, sessionId);
        } finally {
          db.close();
        }
        const remembered = scopeComponentsRef.current;
        if (loadedComponents.length > 0 && remembered?.sessionId !== sessionId) {
          scopeComponentsRef.current = { sessionId, components: loadedComponents };
        }
        // Confirming the scope changes accepted rows to `generated` before the
        // async cache/auth transition completes. A resize can render this case
        // again while those rows are no longer returned by loadScopeComponents;
        // keep the last valid list for this session instead of showing the
        // unrecoverable empty-session error.
        const rememberedForSession =
          scopeComponentsRef.current?.sessionId === sessionId ? scopeComponentsRef.current.components : null;
        const components =
          scopeGateCompletedRef.current && rememberedForSession
            ? rememberedForSession
            : loadedComponents.length > 0
              ? loadedComponents
              : (rememberedForSession ?? []);
        return (
          <ScopeGateStep
            components={components}
            onConfirm={(decisions) => {
              void (async () => {
                selectionToReviewStartedAtRef.current =
                  decisions.accepted.length > 0
                    ? startWizardTimer('selection-to-review', {
                        sessionId,
                        acceptedCount: decisions.accepted.length,
                        rejectedCount: decisions.rejected.length,
                      })
                    : null;
                const preflight = generationCachePreflightRef.current;
                const cachePromise =
                  preflight?.sessionId === sessionId
                    ? preflight.promise
                    : checkGenerateCacheComponents(sessionId, state.tokensPath, true);
                if (!preflight || preflight.sessionId !== sessionId) {
                  generationCachePreflightRef.current = { sessionId, promise: cachePromise };
                }
                // Let the cache restore finish while the selection screen is
                // still visible. Scope decisions are applied only afterward,
                // so the two SQLite writers cannot race.
                const cacheWaitStartedAt = startWizardTimer('selection-cache-restoration-wait', {
                  sessionId,
                  preflight: Boolean(preflight?.sessionId === sessionId),
                });
                try {
                  const cachedNames = await cachePromise;
                  finishWizardTimer('selection-cache-restoration-wait', cacheWaitStartedAt, {
                    status: 'complete',
                    cachedCount: cachedNames.size,
                  });
                } catch (error) {
                  finishWizardTimer('selection-cache-restoration-wait', cacheWaitStartedAt, {
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error),
                  });
                  finishSelectionToReviewTimer('error');
                  throw error;
                }
                await runScopeGate({
                  sessionId,
                  decisions,
                  onAdvanceToGenerate: async ({ sessionId: sid, acceptedCount }) => {
                    scopeGateCompletedRef.current = true;
                    if (shouldGenerateAfterScopeGate({ acceptedCount })) {
                      // Leave the scope-gate view before awaiting auth. The
                      // persisted decisions change accepted rows to `generated`,
                      // so rendering the gate during that await briefly makes
                      // its component query appear empty.
                      const authPromise = runAgentAuthCheck('generating', true);
                      if (await authPromise) {
                        const comparisonStartedAt = startWizardTimer('generation-cache-set-comparison', {
                          sessionId: sid,
                          acceptedCount: decisions?.accepted.length ?? 0,
                        });
                        let cachedNames = await cachePromise;
                        const acceptedNames = decisions?.accepted ?? [];
                        let cacheHit =
                          !effectiveNoCache &&
                          acceptedNames.length > 0 &&
                          acceptedNames.every((name) => cachedNames.has(name));
                        // The preflight may have read a stale review snapshot
                        // while the scope decision was being persisted. Always
                        // refresh a non-hit after that transaction completes so
                        // a partial preflight set cannot trigger generation.
                        if (!cacheHit && !effectiveNoCache && acceptedNames.length > 0) {
                          cachedNames = await checkGenerateCacheComponents(sid, state.tokensPath, true);
                          cacheHit = acceptedNames.every((name) => cachedNames.has(name));
                        }
                        finishWizardTimer('generation-cache-set-comparison', comparisonStartedAt, {
                          status: 'complete',
                          cacheHit,
                          cachedCount: cachedNames.size,
                          acceptedCount: acceptedNames.length,
                        });
                        if (cacheHit) {
                          void finishCachedGeneration(sid, acceptedCount);
                        } else {
                          const acceptedNameSet = new Set(acceptedNames);
                          const restoredCachedNames = [...cachedNames].filter((name) => acceptedNameSet.has(name));
                          update({
                            step: 'generating',
                            generateProgress: null,
                            acceptedCount,
                          });
                          void runGenerate(sid, state.tokensPath, acceptedCount, false, restoredCachedNames);
                        }
                      } else {
                        finishSelectionToReviewTimer('error');
                      }
                      return;
                    }
                    void runSaveAndPush();
                  },
                  onAdvanceToPushFlow: (count) => {
                    scopeGateCompletedRef.current = true;
                    update({ acceptedCount: count, autoRejectedCount: 0 });
                    advanceToPushFlow(count);
                  },
                });
              })();
            }}
            onQuit={() => process.exit(0)}
          />
        );
      }

      case 'generating': {
        const p = state.generateProgress;
        const stepNum = hasTokenStage ? 4 : 3;
        const displayAgent = state.agent.charAt(0).toUpperCase() + state.agent.slice(1);
        const progressDetail = p ? `${p.current}` : `Starting up ${displayAgent}...`;
        const mapTokensDetail =
          state.mapTokensStatus === 'running'
            ? skipMapTokens
              ? 'Resolving token defaults...'
              : `Mapping token restrictions via ${displayAgent}...`
            : state.mapTokensStatus === 'complete'
              ? skipMapTokens
                ? 'Token defaults ready'
                : 'Token restrictions ready'
              : undefined;
        return (
          <RunningStep
            stepNumber={stepNum}
            totalSteps={totalSteps}
            title="Generating definitions"
            description={`${formatAcceptanceSummary({ accepted: state.acceptedCount, autoRejected: state.autoRejectedCount })} ${displayAgent} is mapping your selected components to CDF format.${hasTokens ? ' Using your design tokens for prop resolution.' : ''}`}
            detail={progressDetail}
            detailProgress={p ? { done: p.done, total: p.total } : undefined}
            secondaryDetail={mapTokensDetail}
            secondaryComplete={state.mapTokensStatus === 'complete'}
          />
        );
      }
      case 'mapping-tokens': {
        const stepNum = hasTokenStage ? 5 : 4;
        return (
          <RunningStep
            stepNumber={stepNum}
            totalSteps={totalSteps}
            title="Mapping design tokens"
            description="Finding the design tokens that are valid for each generated token property."
            detail={skipMapTokens ? 'Resolving token defaults...' : `Running ${state.agent}...`}
          />
        );
      }

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
          <CredentialsStep
            initialSpaceId={state.spaceId}
            initialEnvironmentId={state.environmentId}
            initialCmaToken={state.cmaToken}
            initialHost={state.host}
            error={state.credentialsError || undefined}
            validating={state.credentialsValidating}
            backgroundValidating={state.credentialsBackgroundValidating}
            generatePrefetchStatus={state.generatePrefetchStatus}
            generatePrefetchError={state.generatePrefetchError}
            onConfirm={(spaceId, environmentId, cmaToken, host) => {
              void confirmCredentials(spaceId, environmentId, cmaToken, host);
            }}
            onValuesChange={handleCredentialValuesChange}
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
              update({ credentialsSkipped: true, credentialsError: '' });
              credentialsReadyRef.current = true;
              void advanceAfterCredentialsValidated();
            }}
            onQuit={() => {
              cancelGeneratePrefetch();
              process.exit(0);
            }}
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
            summary={[
              (hasComponents || hasTokens) && state.componentsPath ? `components.json → ${state.componentsPath}` : null,
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
            onRetryCredentials={
              state.errorAllowCredentialRetry ? () => update({ step: 'credentials', credentialsError: '' }) : undefined
            }
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
