import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { join, resolve } from 'node:path';
import { appendFileSync, writeFileSync } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { TopBar } from '../../analyze/select/tui/components/TopBar.js';
import type { ReviewSessionSnapshot } from '../../analyze/select/types.js';
import { WelcomeStep } from './steps/WelcomeStep.js';
import { PathValidationStep } from './steps/PathValidationStep.js';
import { RunningStep } from './steps/RunningStep.js';
import { GateStep } from './steps/GateStep.js';
import { CredentialsStep } from './steps/CredentialsStep.js';
import { WizardPreviewStep } from './steps/WizardPreviewStep.js';
import { DoneStep } from './steps/DoneStep.js';
import { ErrorStep } from './steps/ErrorStep.js';
import { TokenInputStep } from './steps/TokenInputStep.js';
import { GenerateReviewStep } from './steps/GenerateReviewStep.js';
import { ImportApiClient, ApiError } from '../../apply/api-client.js';
import { readTokensFromPath, hasBreakingChangesWithImpact } from '../../apply/manifest.js';
import { buildManifest } from '@contentful/experience-design-system-types';
import type { ServerPreviewResponse, ManifestPayload } from '@contentful/experience-design-system-types';
import {
  openPipelineDb,
  loadCDFComponents,
  seedCDFFromPreviewResponse,
  seedDefaultsFromChangedItems,
  backfillUnclassifiedProps,
} from '../../session/db.js';
import { checkAgentAuth, type AgentName } from '../../generate/agent-runner.js';
import { normalizePath } from '../path-utils.js';

type WizardStep =
  | 'welcome'
  | 'token-input'
  | 'token-reuse-gate'
  | 'checking-claude-auth'
  | 'credential-test-gate'
  | 'validating-credentials'
  | 'generating-tokens'
  | 'path-validation'
  | 'extracting'
  | 'review-extraction-gate'
  | 'analyze-select'
  | 'generating'
  | 'review-generated-gate'
  | 'generate-edit'
  | 'generate-review'
  | 'push-decision-gate'
  | 'credentials'
  | 'previewing'
  | 'preview-gate'
  | 'pushing'
  | 'printing'
  | 'print-gate'
  | 'done'
  | 'error';

type PushResult = {
  componentTypes: { created: number; updated: number; failed: number };
  designTokens: { created: number; updated: number; failed: number };
  summary?: { total: number; succeeded: number; failed: number };
};

type WizardState = {
  step: WizardStep;
  agent: string;
  projectPath: string;
  outDir: string;
  rawTokensPath: string;
  tokensPath: string;
  tokenSourceChanged: boolean | null;
  skipComponents: boolean;
  tokenSessionId: string | null;
  extractSessionId: string | null;
  generateSessionId: string | null;
  extractedCount: number;
  acceptedCount: number;
  generatedCount: number;
  generatedAcceptedCount: number;
  generateProgress: { done: number; total: number; current: string } | null;
  extractProgress: { scanned: number; filesProcessed: number; totalFiles: number; componentsFound: number } | null;
  componentsPath: string;
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  credentialsError: string;
  serverPreview: ServerPreviewResponse | null;
  manifest: ManifestPayload | null;
  pushProgress: string | null;
  pushResult: PushResult;
  errorStep: string;
  errorMessage: string;
  errorAllowCredentialRetry: boolean;
  authCheckStepNumber: number;
};

function findCliPath(): string {
  return join(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..', 'bin', 'cli.js');
}

function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    execFile('node', [findCliPath(), ...args], (error, stdout, stderr) => {
      res({ exitCode: error?.code ? Number(error.code) : 0, stdout, stderr });
    });
  });
}

const WIZARD_LOG = join(tmpdir(), 'experiences-import-wizard.log');

function logStep(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  appendFileSync(WIZARD_LOG, line);
}

export type WizardAppProps = {
  initialSpaceId?: string;
  initialEnvironmentId?: string;
  initialCmaToken?: string;
  initialAgent?: string;
  initialProjectPath?: string;
  host?: string;
};

export function WizardApp({
  initialSpaceId = '',
  initialEnvironmentId = 'master',
  initialCmaToken = '',
  initialAgent,
  initialProjectPath,
  host,
}: WizardAppProps = {}): React.ReactElement {
  const apiHost = host ?? process.env['EDS_HOST'];
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  const logInit = useRef(false);
  if (!logInit.current) {
    writeFileSync(WIZARD_LOG, `--- experiences import session ${new Date().toISOString()} ---\n`);
    logInit.current = true;
  }

  const credentialsRef = useRef<{ spaceId: string; environmentId: string; cmaToken: string } | null>(null);
  const sessionRef = useRef<{ extractSessionId: string | null; tokensPath: string }>({
    extractSessionId: null,
    tokensPath: '',
  });

  const [state, setState] = useState<WizardState>({
    step: initialProjectPath ? 'token-input' : 'welcome',
    agent: initialAgent ?? 'claude',
    projectPath: initialProjectPath ?? '',
    outDir: initialProjectPath ? join(resolve(initialProjectPath), '.contentful') : '',
    rawTokensPath: '',
    tokensPath: '',
    tokenSourceChanged: null,
    skipComponents: false,
    tokenSessionId: null,
    extractSessionId: null,
    generateSessionId: null,
    extractedCount: 0,
    acceptedCount: 0,
    generatedCount: 0,
    generatedAcceptedCount: 0,
    generateProgress: null,
    extractProgress: null,
    componentsPath: '',
    spaceId: initialSpaceId,
    environmentId: initialEnvironmentId,
    cmaToken: initialCmaToken,
    credentialsError: '',
    serverPreview: null,
    manifest: null,
    pushProgress: null,
    pushResult: {
      componentTypes: { created: 0, updated: 0, failed: 0 },
      designTokens: { created: 0, updated: 0, failed: 0 },
    },
    errorStep: '',
    errorMessage: '',
    errorAllowCredentialRetry: false,
    authCheckStepNumber: 1,
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
    const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((res) => {
      const child = spawn('node', [
        findCliPath(),
        'generate',
        'tokens',
        '--agent',
        state.agent,
        '--raw-tokens',
        rawTokensPath,
      ]);
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
      update({ step: 'error', errorStep: 'generate tokens', errorMessage: result.stderr.trim() || 'Unknown error' });
      return;
    }
    const sessionMatch = /^session:\s*(.+)$/m.exec(result.stdout);
    const tokenSessionId = sessionMatch ? sessionMatch[1]!.trim() : null;

    const tokensPath = join(outDir, 'tokens.json');
    const printArgs = ['print', 'tokens', '--out', tokensPath];
    if (tokenSessionId) printArgs.push('--session', tokenSessionId);
    const r = await runCli(printArgs);
    if (r.exitCode !== 0) {
      update({ step: 'error', errorStep: 'print tokens', errorMessage: r.stderr.trim() || 'Unknown error' });
      return;
    }
    update({ step: 'path-validation', tokensPath, tokenSessionId });
  };

  const runExtract = async (projectPath: string) => {
    const outDir = join(resolve(projectPath), '.contentful');
    update({ step: 'extracting', outDir, extractProgress: null });
    const r = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((res) => {
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
      update({ step: 'error', errorStep: 'analyze extract', errorMessage: r.stderr.trim() || 'Unknown error' });
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
    update({ step: 'review-extraction-gate', extractSessionId, extractedCount });
  };

  const runAnalyzeSelect = async (
    sessionId: string,
    extractedCount: number,
    tokensPath: string,
    acceptAll: boolean,
  ) => {
    logStep({ fn: 'runAnalyzeSelect:enter', sessionId, extractedCount, acceptAll });
    let acceptedCount: number;
    if (acceptAll) {
      logStep({ fn: 'runAnalyzeSelect:acceptAll-skip-spawn' });
      acceptedCount = extractedCount;
    } else {
      if (state.serverPreview && !process.env['EDS_PREVIEW_ANNOTATIONS']) {
        process.env['EDS_PREVIEW_ANNOTATIONS'] = JSON.stringify(buildPreviewAnnotations(state.serverPreview));
      }

      update({ step: 'analyze-select' });
      const r = await runCliInteractive(['analyze', 'select', '--session', sessionId]);

      logStep({ fn: 'runAnalyzeSelect:post-spawn', exitCode: r.exitCode });
      clearPreviewEnvVars();

      if (r.exitCode !== 0) {
        update({ step: 'error', errorStep: 'analyze select', errorMessage: r.stderr.trim() || 'Unknown error' });
        return;
      }
      // Read accepted count from the review state file (since TUI subprocess inherits stdio)
      const artifactsRoot = process.env['EDS_REVIEW_ARTIFACTS_DIR']
        ? resolve(process.env['EDS_REVIEW_ARTIFACTS_DIR'])
        : resolve(homedir(), '.contentful', 'experience-design-system-cli', 'reviews');
      const reviewStatePath = resolve(artifactsRoot, sessionId, 'current-review-state.json');
      try {
        const reviewState = JSON.parse(await readFile(reviewStatePath, 'utf8')) as ReviewSessionSnapshot;
        acceptedCount = reviewState.components.filter((c) => c.status === 'accepted').length;
      } catch {
        acceptedCount = extractedCount;
      }
    }
    update({ acceptedCount });
    if (acceptedCount > 0) {
      if (await runAgentAuthCheck('generating')) {
        void runGenerate(sessionId, tokensPath, acceptedCount);
      }
    } else {
      advanceToPushFlow(0);
    }
  };

  const runGenerate = async (extractSessionId: string, tokensPath: string, acceptedCount: number) => {
    const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((res) => {
      const args = [findCliPath(), 'generate', 'components', '--agent', state.agent, '--session', extractSessionId];
      if (tokensPath) args.push('--tokens', tokensPath);
      const child = spawn('node', args);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += String(d);
      });
      child.stderr.on('data', (d: Buffer) => {
        const chunk = String(d);
        stderr += chunk;
        for (const line of chunk.split('\n')) {
          const m = /\[(\d+)\/(\d+)\]\s+(.+)/.exec(line);
          if (m) update({ generateProgress: { done: Number(m[1]), total: Number(m[2]), current: m[3]!.trim() } });
        }
      });
      child.on('exit', (code) => res({ exitCode: code ?? 0, stdout, stderr }));
    });

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
    update({ step: 'review-generated-gate', generateSessionId, generatedCount, generateProgress: null });
  };

  const advanceToPushFlow = (generatedAcceptedCount: number) => {
    update({ generatedAcceptedCount, step: 'credentials' });
  };

  const runGenerateEdit = async (
    sessionId: string | null,
    generatedCount: number,
    acceptAll: boolean,
    returnToPreview = false,
  ) => {
    let generatedAcceptedCount: number;
    if (acceptAll) {
      generatedAcceptedCount = generatedCount;
    } else {
      update({ step: 'generate-edit' });
      if (sessionId) {
        const r = await runCliInteractive(['generate', 'components', 'edit', '--session', sessionId]);
        if (r.exitCode !== 0) {
          update({ step: 'error', errorStep: 'generate edit', errorMessage: r.stderr.trim() || 'Unknown error' });
          return;
        }
        const acceptedMatch = /Accepted: (\d+)/.exec(r.stderr);
        generatedAcceptedCount = acceptedMatch ? Number(acceptedMatch[1]) : generatedCount;
      } else {
        generatedAcceptedCount = generatedCount;
      }
    }
    if (returnToPreview) {
      const { extractSessionId, tokensPath } = sessionRef.current;
      void runPreview(extractSessionId, tokensPath, state.spaceId, state.environmentId, state.cmaToken);
    } else {
      advanceToPushFlow(generatedAcceptedCount);
    }
  };

  const setPreviewEnvVars = () => {
    const creds = credentialsRef.current;
    const cmaToken = creds?.cmaToken || state.cmaToken;
    const spaceId = creds?.spaceId || state.spaceId;
    const environmentId = creds?.environmentId || state.environmentId;
    if (cmaToken) process.env['EDS_CMA_TOKEN'] = cmaToken;
    if (spaceId) process.env['EDS_SPACE_ID'] = spaceId;
    if (environmentId) process.env['EDS_ENVIRONMENT_ID'] = environmentId;
    process.env['EDS_TOKENS_PATH'] = state.tokensPath || '';
  };

  const clearPreviewEnvVars = () => {
    delete process.env['EDS_PREVIEW_ANNOTATIONS'];
    delete process.env['EDS_PREVIEW_COUNTS'];
    delete process.env['EDS_CMA_TOKEN'];
    delete process.env['EDS_SPACE_ID'];
    delete process.env['EDS_ENVIRONMENT_ID'];
    delete process.env['EDS_TOKENS_PATH'];
  };

  const runEditFromPreview = async (preview: ServerPreviewResponse | null) => {
    const sessionId = state.extractSessionId;
    if (!sessionId) {
      update({ step: 'error', errorStep: 'edit definitions', errorMessage: 'No session available for editing' });
      return;
    }

    process.env['EDS_PREVIEW_ANNOTATIONS'] = JSON.stringify(buildPreviewAnnotations(preview));
    if (preview) {
      process.env['EDS_PREVIEW_COUNTS'] = JSON.stringify({
        compNew: preview.components.new.length,
        compChanged: preview.components.changed.length,
        compRemoved: preview.components.removed.length,
        compUnchanged: preview.components.unchanged.length,
        tokNew: preview.tokens.new.length,
        tokChanged: preview.tokens.changed.length,
        tokRemoved: preview.tokens.removed.length,
        tokUnchanged: preview.tokens.unchanged.length,
      });
    }
    setPreviewEnvVars();

    update({ step: 'analyze-select' });
    const r = await runCliInteractive(['analyze', 'select', '--session', sessionId]);

    clearPreviewEnvVars();

    if (r.exitCode !== 0) {
      update({ step: 'error', errorStep: 'edit definitions', errorMessage: 'Editor exited with an error' });
      return;
    }

    // Re-preview with updated definitions
    const { extractSessionId: sid, tokensPath: tp } = sessionRef.current;
    void runPreview(sid, tp, state.spaceId, state.environmentId, state.cmaToken);
  };

  const confirmCredentials = (spaceId: string, environmentId: string, cmaToken: string) => {
    credentialsRef.current = { spaceId, environmentId, cmaToken };
    update({ spaceId, environmentId, cmaToken, step: 'credential-test-gate' });
  };

  const validateCredentials = async (spaceId: string, environmentId: string, cmaToken: string) => {
    update({ step: 'validating-credentials' });
    try {
      const client = new ImportApiClient({ cmaToken, spaceId, environmentId, host: apiHost });
      await client.validateToken();
      const { extractSessionId, tokensPath } = sessionRef.current;
      void runPreview(extractSessionId, tokensPath, spaceId, environmentId, cmaToken);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        update({ step: 'credentials', credentialsError: e.message });
        return;
      }
      const msg = e instanceof Error ? e.message : 'Credential check failed';
      update({
        step: 'error',
        errorStep: 'validating-credentials',
        errorMessage: msg,
        errorAllowCredentialRetry: false,
      });
    }
  };

  const runPreview = async (
    extractSessionId: string | null,
    tokensPath: string,
    spaceId: string,
    environmentId: string,
    cmaToken: string,
  ) => {
    update({ step: 'previewing' });
    try {
      const client = new ImportApiClient({ cmaToken, spaceId, environmentId, host: apiHost });

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

      update({ step: 'preview-gate', serverPreview: preview, manifest });
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
              (apiHost ? `  Host:        ${apiHost}\n` : '') +
              `\nIf using a custom --host, make sure the space exists on that host.`,
          });
          return;
        }
        update({ step: 'error', errorStep: 'apply preview', errorMessage: e.message, errorAllowCredentialRetry: true });
        return;
      }
      const msg = e instanceof Error ? e.message : 'Preview failed';
      update({ step: 'error', errorStep: 'apply preview', errorMessage: msg, errorAllowCredentialRetry: true });
    }
  };

  const runPush = async (
    manifest: ManifestPayload,
    spaceId: string,
    environmentId: string,
    cmaToken: string,
    acknowledgeBreakingChanges: boolean,
    preview?: ServerPreviewResponse | null,
  ) => {
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
            componentTypes: { created: 0, updated: 0, failed: 0 },
            designTokens: { created: 0, updated: 0, failed: 0 },
          },
        });
        return;
      }
    }
    update({ step: 'pushing' });
    try {
      const client = new ImportApiClient({ cmaToken, spaceId, environmentId, host: apiHost });
      let operation = await client.applyImport(manifest, acknowledgeBreakingChanges);
      try {
        logStep({
          applyResponse: { status: operation?.sys?.status, id: operation?.sys?.id, keys: Object.keys(operation ?? {}) },
        });
      } catch (err) {
        process.stderr.write(`[eds] log write failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      update({ pushProgress: `Queued (operation ${operation.sys.id.slice(0, 8)}...)` });

      let pollCount = 0;
      operation = await client.pollOperation(operation.sys.id, {
        onProgress: (op) => {
          pollCount++;
          const s = op.summary;
          if (s) {
            const done = s.total - s.pending;
            update({ pushProgress: `${done}/${s.total} entities processed` });
          }
          try {
            logStep({ pollTick: { attempt: pollCount, status: op.sys.status, summary: op.summary } });
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
            failed: items.filter((i) => i.entityType === 'ComponentType' && i.status === 'failed').length,
          },
          designTokens: {
            created: items.filter(
              (i) => i.entityType === 'DesignToken' && i.action === 'create' && i.status === 'succeeded',
            ).length,
            updated: items.filter(
              (i) => i.entityType === 'DesignToken' && i.action === 'update' && i.status === 'succeeded',
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
            failed: 0,
          },
          designTokens: {
            created: preview?.tokens.new.length ?? 0,
            updated: preview?.tokens.changed.length ?? 0,
            failed: 0,
          },
          summary: operation.summary,
        };
      }
      update({ step: 'done', pushResult });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Push failed';
      update({ step: 'error', errorStep: 'apply push', errorMessage: msg, errorAllowCredentialRetry: true });
    }
  };

  const runPrintFiles = async (extractSessionId: string | null, outDir: string) => {
    update({ step: 'printing' });
    const componentsPath = join(outDir, 'components.json');
    const printArgs = ['print', 'components', '--out', componentsPath];
    if (extractSessionId) printArgs.push('--session', extractSessionId);
    const r = await runCli(printArgs);
    if (r.exitCode !== 0) {
      update({ step: 'error', errorStep: 'print components', errorMessage: r.stderr.trim() || 'Unknown error' });
      return;
    }
    // tokensPath is already on disk from generate-tokens step; just record it
    update({ step: 'print-gate', componentsPath });
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
          update({ step: 'token-reuse-gate', tokensPath: existingTokensPath, tokenSourceChanged: sourceChanged });
        } catch {
          // No existing tokens — need LLM to generate
          if (await runAgentAuthCheck('generating-tokens')) {
            void runGenerateTokens(state.rawTokensPath, state.outDir);
          }
        }
      })();
    }
  }, [state.step]); // intentional: only re-run when step changes

  // ── Render ────────────────────────────────────────────────────────────────────────────

  const noQuitSteps: WizardStep[] = [
    'checking-claude-auth',
    'validating-credentials',
    'generating-tokens',
    'extracting',
    'generating',
    'printing',
    'previewing',
    'pushing',
  ];
  const hints = noQuitSteps.includes(state.step) ? [] : [{ key: 'q', label: 'quit' }];

  // step count: tokens step adds 1, components steps add 2 (extract + generate)
  const hasTokens = !!state.tokensPath;
  const hasComponents = !state.skipComponents;
  const totalSteps = 3 + (hasTokens ? 1 : 0) + (hasComponents ? 2 : 0);

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
            onSkipComponents={() => update({ step: 'push-decision-gate', skipComponents: true })}
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

      case 'review-extraction-gate': {
        const stepNum = hasTokens ? 2 : 1;
        return (
          <GateStep
            successMessage={`Step ${stepNum} complete`}
            summary={`Found ${state.extractedCount} component${state.extractedCount === 1 ? '' : 's'}.`}
            context="Ready to review what was extracted? You can correct any props the extractor got wrong, or approve everything and move on."
            continueLabel="Review components"
            skipLabel="Approve all and skip"
            onContinue={() => {
              if (!state.extractSessionId) {
                update({
                  step: 'error',
                  errorStep: 'analyze extract',
                  errorMessage: 'Extract session ID missing — please re-run.',
                });
                return;
              }
              void runAnalyzeSelect(state.extractSessionId, state.extractedCount, state.tokensPath, false);
            }}
            onSkip={() => {
              if (!state.extractSessionId) {
                update({
                  step: 'error',
                  errorStep: 'analyze extract',
                  errorMessage: 'Extract session ID missing — please re-run.',
                });
                return;
              }
              void runAnalyzeSelect(state.extractSessionId, state.extractedCount, state.tokensPath, true);
            }}
            onQuit={() => process.exit(0)}
          />
        );
      }

      case 'analyze-select':
        return (
          <Box paddingX={2} paddingY={1}>
            <Text dimColor>Launching component review... (the TUI will appear shortly)</Text>
          </Box>
        );

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
            description={`${state.acceptedCount} component${state.acceptedCount === 1 ? '' : 's'} accepted. ${state.agent} is mapping your TypeScript types to Contentful's CDF format.${hasTokens ? ' Using your design tokens for prop resolution.' : ''}`}
            detail={progressDetail}
          />
        );
      }

      case 'review-generated-gate': {
        const stepNum = hasTokens ? 4 : 3;
        return (
          <GateStep
            successMessage={`Step ${stepNum} complete — definitions generated`}
            summary={`Generated definitions for ${state.generatedCount} component${state.generatedCount === 1 ? '' : 's'}.`}
            context="Take a final look before pushing to Contentful. You can accept, reject, or inspect each component's generated definition."
            continueLabel="Review definitions"
            skipLabel="Approve all and skip"
            onContinue={() => {
              update({ step: 'generate-review' });
            }}
            onSkip={() => {
              void runGenerateEdit(state.generateSessionId, state.generatedCount, true);
            }}
            onQuit={() => process.exit(0)}
          />
        );
      }

      case 'generate-review': {
        if (!state.extractSessionId) {
          return (
            <Box paddingX={2} paddingY={1}>
              <Text color="red">Error: no session ID — cannot load generated definitions.</Text>
            </Box>
          );
        }
        return (
          <GenerateReviewStep
            extractSessionId={state.extractSessionId}
            onFinalize={(accepted, rejected) => {
              update({ generatedAcceptedCount: accepted, step: 'push-decision-gate' });
              void Promise.resolve();
              // log so orchestrator can read it
              process.stderr.write(`Accepted: ${accepted}  Rejected: ${rejected}\n`);
            }}
            onQuit={() => process.exit(0)}
          />
        );
      }

      case 'generate-edit':
        return (
          <Box paddingX={2} paddingY={1}>
            <Text dimColor>Launching definition review... (the TUI will appear shortly)</Text>
          </Box>
        );

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
          <GateStep
            successMessage="Generation complete"
            summary={summary}
            context={`Push directly to your Contentful space now, or save ${files || 'the output files'} to disk first.`}
            continueLabel="Push to Contentful"
            skipLabel={`Save ${files || 'files'} to disk`}
            onContinue={() => {
              update({ step: 'credentials' });
            }}
            onSkip={() => {
              void runPrintFiles(state.extractSessionId, state.outDir);
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
            error={state.credentialsError || undefined}
            onConfirm={confirmCredentials}
            onContinue={confirmCredentials}
            onQuit={() => process.exit(0)}
          />
        );

      case 'credential-test-gate':
        return (
          <GateStep
            successMessage="Credentials entered"
            summary={`Space: ${state.spaceId}  ·  Environment: ${state.environmentId}`}
            context="Verify your credentials work before running the import, or skip and find out during the push step."
            continueLabel="Test credentials"
            skipLabel="Skip and continue"
            showSkip={true}
            onContinue={() => {
              void validateCredentials(state.spaceId, state.environmentId, state.cmaToken);
            }}
            onSkip={() => {
              const { extractSessionId, tokensPath } = sessionRef.current;
              void runPreview(extractSessionId, tokensPath, state.spaceId, state.environmentId, state.cmaToken);
            }}
            onQuit={() => process.exit(0)}
          />
        );

      case 'validating-credentials':
        return (
          <RunningStep
            stepNumber={totalSteps - 1}
            totalSteps={totalSteps}
            title="Validating credentials"
            description="Checking that your space ID and CMA token are valid..."
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
                acknowledge,
                state.serverPreview,
              );
            }}
            onEdit={() => {
              void runEditFromPreview(state.serverPreview);
            }}
            onSaveFiles={() => {
              void runPrintFiles(state.extractSessionId, state.outDir);
            }}
            onQuit={() => process.exit(0)}
          />
        );

      case 'pushing':
        return (
          <RunningStep
            stepNumber={totalSteps}
            totalSteps={totalSteps}
            title="Push to Contentful"
            description="Writing component types and design tokens to your Contentful space..."
            detail={state.pushProgress ?? undefined}
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

      case 'print-gate':
        return (
          <GateStep
            successMessage="Files saved"
            summary={[
              hasComponents && state.componentsPath ? `components.json → ${state.componentsPath}` : null,
              hasTokens && state.tokensPath ? `tokens.json → ${state.tokensPath}` : null,
            ]
              .filter(Boolean)
              .join('\n')}
            context="Your files are saved to disk. Run `experiences import` again when you're ready to push to Contentful."
            continueLabel="Exit"
            showSkip={false}
            onContinue={() => process.exit(0)}
            onQuit={() => process.exit(0)}
          />
        );

      case 'done': {
        const totalFailed = state.pushResult.componentTypes.failed + state.pushResult.designTokens.failed;
        return (
          <DoneStep
            componentTypes={state.pushResult.componentTypes}
            designTokens={state.pushResult.designTokens}
            summary={state.pushResult.summary}
            spaceId={state.spaceId}
            environmentId={state.environmentId}
            onExit={() => process.exit(totalFailed > 0 ? 1 : 0)}
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
    }
  })();

  return (
    <Box flexDirection="column" width={terminalWidth}>
      <TopBar subcommand="import" hints={hints} />
      {stepContent}
    </Box>
  );
}

function buildPreviewAnnotations(preview: ServerPreviewResponse | null): Record<string, string> {
  const annotations: Record<string, string> = {};
  if (!preview) return annotations;
  for (const item of preview.components.new) {
    const key = ((item as unknown as Record<string, unknown>).key as string) ?? '';
    if (key) annotations[key] = 'new';
  }
  for (const item of preview.components.removed) {
    annotations[item.name] = 'removed';
  }
  for (const item of preview.components.changed) {
    if (item.changeClassification?.classification === 'breaking') {
      annotations[item.current.name] = 'breaking';
    } else {
      annotations[item.current.name] = 'changed';
    }
  }
  return annotations;
}

// Interactive subprocess helper — uses spawn with inherited stdio so child isTTY is true
function runCliInteractive(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  logStep({
    fn: 'runCliInteractive:spawn',
    args,
  });
  return new Promise((res) => {
    const child = spawn('node', [findCliPath(), ...args], { stdio: 'inherit' });
    child.on('exit', (code) => {
      logStep({ fn: 'runCliInteractive:exit', args, exitCode: code ?? 0 });
      res({ exitCode: code ?? 0, stdout: '', stderr: '' });
    });
  });
}
