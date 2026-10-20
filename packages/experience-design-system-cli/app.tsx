import { join } from 'node:path';
import React, { useEffect, useRef, useState } from 'react';
import { HomeScreen } from './src/tui/home/home.js';
import { ImportScreen } from './src/tui/import/PageContainer.js';
import {
  CredentialsScreen,
  ExtractionScreen,
  PathValidationScreen,
  TokenInputScreen,
  TokenReuseScreen,
  WelcomeScreen,
} from './src/tui/import/steps/index.js';
import { ErrorStep } from './src/tui/import/shared/index.js';
import { resolveAgentChoice, stepNumbers } from './src/tui/import/steps/06-extraction/logic.js';
import { readSettings } from '@contentful/experience-design-system-types/config';
import { useExtraction } from './src/tui/import/steps/06-extraction/use-extraction.js';
import { ScopeGateScreen } from './src/tui/import/steps/07-scope-gate/screen.js';
import { useScopeGateFlow } from './src/tui/import/steps/07-scope-gate/use-scope-gate-flow.js';
import { GenerationScreen } from './src/tui/import/steps/08-generation/screen.js';
import { useGeneration } from './src/tui/import/steps/08-generation/use-generation.js';
import type { GenerationInput } from './src/tui/import/steps/08-generation/types.js';
import type { ExtractionHandoff } from '@contentful/experience-design-system-types/handoff';
import type { ExtractionInput } from './src/tui/import/steps/06-extraction/types.js';
import { inspectTokens, type TokenStrategy } from './src/tui/import/steps/05-token-reuse/logic.js';
import { resolveUserPath } from './src/tui/import/resolve-user-path.js';
import type { CredentialsResult } from './src/tui/import/steps/04-credentials/screen.js';
import type { ImportOptions } from './src/commands/import-options.js';
import { buildFlowStart } from './src/tui/import/steps/10-flow/flow/build-flow-start.js';
import type { FlowStart } from './src/tui/import/steps/10-flow/flow/controller.js';
import { FlowScreen } from './src/tui/import/steps/10-flow/flow/screen.js';
import { useFlow } from './src/tui/import/steps/10-flow/flow/use-flow.js';
import { HelpScreen } from './src/tui/help/PageContainer.js';
import { SettingsScreen } from './src/tui/settings/PageContainer.js';
import { ConfigurationScreen } from './src/tui/settings/contentful-configuration/ContentfulConfigScreen.js';
import { OptInAnalyticsScreen } from './src/tui/settings/opt-in-analytics/screen.js';
import { UpgradeScreen } from './src/tui/upgrade/PageContainer.js';
import { DebugModeScreen } from './src/tui/settings/debug-mode/screen.js';
import {
  readCredentials,
  writeCredentials,
  type V1Credentials,
} from './src/tui/settings/contentful-configuration/config-store.js';
import {
  awaitForCurrentImportAttempt,
  createImportAttemptOwner,
  isAbortError,
  trackImportWork,
  type ImportAttempt,
  type ImportAttemptOwner,
} from './src/tui/import/cancellation.js';

export type Screen =
  | 'start'
  | 'import'
  | 'help'
  | 'settings'
  | 'settings-configuration'
  | 'settings-opt-in-analytics'
  | 'settings-debug-mode'
  | 'upgrade';

/** What the import was started with: the paths the screens collected and the flags from the command line. */
interface ImportLaunch extends Partial<ImportOptions> {
  projectPath?: string;
  tokens?: string;
  filePaths?: string[];
}

interface PendingLaunch {
  launch: ImportLaunch;
  credentials: CredentialsResult;
  attempt: ImportAttempt;
  cached?: { tokensPath: string; sourceChanged: boolean };
}

interface ExtractionRun {
  attempt: ImportAttempt;
  launch: ImportLaunch;
  credentialsSkipped: boolean;
  tokenStrategy: TokenStrategy;
  input: ExtractionInput;
  /** A custom prompt for `generate components`, saved in the config. Read now, used when generation starts. */
  generatePromptPath?: string;
}

// Set once extraction has produced a session; the scope gate runs for it before the review starts.
interface ScopeRun {
  attempt: ImportAttempt;
  launch: ImportLaunch;
  credentialsSkipped: boolean;
  tokenStrategy: TokenStrategy;
  input: ExtractionInput;
  generatePromptPath?: string;
  extraction: ExtractionHandoff;
}

interface AppProps {
  importOptions: ImportOptions;
  inkClear: () => void;
}

function App({ importOptions, inkClear }: AppProps): React.ReactElement {
  const attemptOwnerRef = useRef<ImportAttemptOwner | undefined>(undefined);
  if (!attemptOwnerRef.current) attemptOwnerRef.current = createImportAttemptOwner();
  const attemptOwner = attemptOwnerRef.current;
  const beginAttempt = (): ImportAttempt => attemptOwner.begin();
  const cancelAttempt = (): void => attemptOwner.cancel();
  const isActiveAttempt = (attempt: ImportAttempt): boolean => attemptOwner.isCurrent(attempt);

  const [screen, setScreen] = useState<Screen>('start');
  // Set when the import has ended, with the exit code the result screen shows.
  const [importExitCode, setImportExitCode] = useState<number>();
  const [launchError, setLaunchError] = useState<{ stepName: string; message: string }>();
  const showImportResult = importExitCode !== undefined;
  const [projectPath, setProjectPath] = useState<string>();
  const [tokensPath, setTokensPath] = useState<string>();
  const [scannedFiles, setScannedFiles] = useState<string[]>();
  // Set once credentials are done while the token catalog is checked; shown as the token reuse screen when it needs a choice.
  const [pendingLaunch, setPendingLaunch] = useState<PendingLaunch>();
  // Set once the token step has an answer; the extraction stage runs for it before the legacy wizard starts.
  const [extractionRun, setExtractionRun] = useState<ExtractionRun>();
  const extraction = useExtraction(extractionRun?.input);
  const [scopeRun, setScopeRun] = useState<ScopeRun>();
  const scopeFlow = useScopeGateFlow(
    scopeRun && {
      attemptId: scopeRun.attempt.id,
      signal: scopeRun.attempt.controller.signal,
      sessionId: scopeRun.extraction.sessionId,
      cache: {
        sessionId: scopeRun.extraction.sessionId,
        tokensPath: scopeRun.extraction.tokensPath,
        agent: scopeRun.input.agent,
        ...(scopeRun.input.agentModel ? { agentModel: scopeRun.input.agentModel } : {}),
        promptOverrides: scopeRun.input.promptOverrides,
        existingEntitiesPath: scopeRun.extraction.existingEntitiesPath,
        noCache: scopeRun.input.noCache,
      },
    },
  );
  // The user's choices are made; generation runs for them before the legacy wizard starts.
  const [generationInput, setGenerationInput] = useState<GenerationInput>();
  const generation = useGeneration(generationInput);
  // Set once generation has finished; the review, save, preview and push run for it.
  const [flowStart, setFlowStart] = useState<FlowStart>();
  const flow = useFlow(flowStart, { beforeStepChange: inkClear });
  const [importDefaults, setImportDefaults] = useState<{
    componentDir: string;
    tokenFile: string;
    credentials: V1Credentials;
  }>();

  useEffect(() => () => cancelAttempt(), []);

  // Read the saved defaults each time the import flow opens, so a change in Settings shows up right away.
  // The screens only read their initial value on mount, so they wait for this to resolve.
  useEffect(() => {
    if (screen !== 'import') {
      setImportDefaults(undefined);
      return;
    }
    let disposed = false;
    setLaunchError(undefined);
    void readCredentials()
      .then((saved) => {
        if (disposed) return;
        setImportDefaults({
          componentDir: saved.defaultComponentDir ?? '',
          tokenFile: saved.defaultTokenFile ?? '',
          credentials: saved,
        });
      })
      .catch((error: unknown) => {
        if (!disposed)
          setLaunchError({
            stepName: 'load import settings',
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      disposed = true;
    };
  }, [screen]);

  const failLaunch = (attempt: ImportAttempt, stepName: string, error: unknown): void => {
    if (!isActiveAttempt(attempt)) return;
    cancelAttempt();
    setLaunchError({ stepName, message: error instanceof Error ? error.message : String(error) });
  };

  const finishCredentials = async (
    result: CredentialsResult,
    projectPath: string,
    tokens: string,
    filePaths: string[],
  ): Promise<void> => {
    const attempt = beginAttempt();
    setLaunchError(undefined);
    try {
      if (!result.skipped) {
        const saved = await awaitForCurrentImportAttempt(attempt, attemptOwner.isCurrent, () =>
          writeCredentials({ ...result.credentials }),
        );
        if (!saved.current) return;
      }
      const launch: ImportLaunch = { projectPath, tokens, filePaths, ...importOptions };
      // earlier catalogs sit in the .contentful folder, in each session's dsi-import folder
      const inspected = await awaitForCurrentImportAttempt(attempt, attemptOwner.isCurrent, () =>
        inspectTokens({
          rawTokensPath: tokens,
          contentfulDir: join(resolveUserPath(projectPath), '.contentful'),
          cache: importOptions.cache,
        }),
      );
      if (!inspected.current) return;
      const state = inspected.value;
      if (state.kind === 'cached') {
        setPendingLaunch({
          launch,
          credentials: result,
          attempt,
          cached: { tokensPath: state.tokensPath, sourceChanged: state.sourceChanged },
        });
        return;
      }
      await startExtraction(launch, 'generate', result, attempt);
    } catch (error) {
      if (isAbortError(error)) {
        if (isActiveAttempt(attempt)) cancelAttempt();
      } else failLaunch(attempt, 'prepare import', error);
    }
  };

  const chooseTokenStrategy = (pending: PendingLaunch, tokenStrategy: TokenStrategy): void => {
    if (!isActiveAttempt(pending.attempt)) return;
    setPendingLaunch(undefined);
    void trackImportWork(startExtraction(pending.launch, tokenStrategy, pending.credentials, pending.attempt));
  };

  const startExtraction = async (
    launch: ImportLaunch,
    tokenStrategy: TokenStrategy,
    credentials: CredentialsResult,
    attempt: ImportAttempt,
  ): Promise<void> => {
    try {
      const settingsResult = await awaitForCurrentImportAttempt(attempt, attemptOwner.isCurrent, readSettings);
      if (!settingsResult.current) return;
      const settings = settingsResult.value;
      const { agent, agentModel } = resolveAgentChoice(launch.agent, settings);
      const generatePromptPath =
        typeof settings.generatePromptPath === 'string' ? settings.generatePromptPath : undefined;
      // Loaded on first use because the debug store reads the settings as soon as it is imported.
      const debugStoreResult = await awaitForCurrentImportAttempt(
        attempt,
        attemptOwner.isCurrent,
        () => import('./src/tui/debug-store.js'),
      );
      if (!debugStoreResult.current) return;
      const outDirResult = await awaitForCurrentImportAttempt(attempt, attemptOwner.isCurrent, () =>
        debugStoreResult.value.startImportRun(resolveUserPath(launch.projectPath ?? '')),
      );
      if (!outDirResult.current) return;
      const outDir = outDirResult.value;
      setExtractionRun({
        attempt,
        ...(generatePromptPath ? { generatePromptPath } : {}),
        // the later steps get the same agent, so they use what the stage used
        launch: { ...launch, agent: agentModel ? `${agent}:${agentModel}` : agent },
        credentialsSkipped: credentials.skipped,
        tokenStrategy,
        input: {
          signal: attempt.controller.signal,
          projectPath: resolveUserPath(launch.projectPath ?? ''),
          outDir,
          filePaths: launch.filePaths ?? [],
          rawTokensPath: launch.tokens ?? '',
          tokenStrategy,
          credentials: credentials.skipped ? null : credentials.credentials,
          agent,
          ...(agentModel ? { agentModel } : {}),
          promptOverrides: launch.prompt ?? [],
          noCache: launch.cache === false,
        },
      });
    } catch (error) {
      if (isAbortError(error)) {
        if (isActiveAttempt(attempt)) cancelAttempt();
      } else failLaunch(attempt, 'prepare import', error);
    }
  };

  // A finished extraction opens the scope gate, once, with what the stage produced.
  useEffect(() => {
    if (
      !extractionRun ||
      !isActiveAttempt(extractionRun.attempt) ||
      extraction?.status !== 'done' ||
      !extraction.result.ok
    )
      return;
    setExtractionRun(undefined);
    setScopeRun({ ...extractionRun, extraction: extraction.result.extraction });
  }, [extraction, extractionRun]);

  // A confirmed scope starts generation, once. The cache check that ran at the gate is handed over so generation can
  // wait for it before it saves the decisions.
  useEffect(() => {
    if (!scopeRun || !isActiveAttempt(scopeRun.attempt) || scopeFlow?.status !== 'confirmed' || generationInput) return;
    const { extraction: produced, input, generatePromptPath } = scopeRun;
    setGenerationInput({
      signal: scopeRun.attempt.controller.signal,
      sessionId: produced.sessionId,
      decisions: scopeFlow.decisions,
      cachedNames: scopeFlow.cachedNames,
      tokensPath: produced.tokensPath,
      tokenSessionId: produced.tokenSessionId,
      existingEntitiesPath: produced.existingEntitiesPath,
      agent: input.agent,
      ...(input.agentModel ? { agentModel: input.agentModel } : {}),
      promptOverrides: input.promptOverrides,
      noCache: input.noCache,
      hasTokens: produced.tokensPath !== '',
      ...(generatePromptPath ? { generatePromptPath } : {}),
    });
  }, [scopeFlow, scopeRun, generationInput]);

  // Finished generation starts the review and everything after it, exactly once, with everything the stages did.
  useEffect(() => {
    if (!scopeRun || !isActiveAttempt(scopeRun.attempt) || generation?.status !== 'done' || !generation.result.ok)
      return;
    const { credentialsSkipped, tokenStrategy, extraction: produced, input, generatePromptPath } = scopeRun;
    inkClear();
    setScopeRun(undefined);
    setGenerationInput(undefined);
    setFlowStart(
      buildFlowStart({
        extraction: input,
        saved: importDefaults?.credentials,
        handoff: {
          credentialsSkipped,
          tokens: { strategy: tokenStrategy },
          extraction: produced,
          generation: generation.result.generation,
        },
        generatePromptPath,
      }),
    );
  }, [generation, scopeRun]);

  const goToStart = (): void => setScreen('start');
  const goToSettings = (): void => setScreen('settings');

  const resetImport = (): void => {
    cancelAttempt();
    setLaunchError(undefined);
    setProjectPath(undefined);
    setTokensPath(undefined);
    setScannedFiles(undefined);
    setPendingLaunch(undefined);
    setExtractionRun(undefined);
    setScopeRun(undefined);
    setGenerationInput(undefined);
    setFlowStart(undefined);
  };

  const finishImportResult = (): void => {
    setImportExitCode(undefined);
    resetImport();
    goToStart();
  };

  const leaveImport = (): void => {
    resetImport();
    goToStart();
  };

  switch (screen) {
    case 'import':
      if (showImportResult) return <ImportScreen exitCode={importExitCode} onDone={finishImportResult} />;
      if (launchError)
        return <ErrorStep stepName={launchError.stepName} message={launchError.message} onExit={leaveImport} />;
      if (flow && flowStart) {
        return (
          <FlowScreen
            state={flow.state}
            controller={flow.controller}
            generatePromptPath={flowStart.generatePromptPath}
            onExit={setImportExitCode}
          />
        );
      }
      if (importDefaults === undefined) return <></>;
      if (projectPath === undefined) {
        return (
          <WelcomeScreen onContinue={setProjectPath} onQuit={leaveImport} initialPath={importDefaults.componentDir} />
        );
      }
      if (tokensPath === undefined) {
        return (
          <TokenInputScreen
            initialPath={importDefaults.tokenFile}
            onConfirm={setTokensPath}
            onBack={() => setProjectPath(undefined)}
          />
        );
      }
      if (scannedFiles === undefined) {
        return (
          <PathValidationScreen
            projectPath={projectPath}
            onConfirm={({ filePaths }) => setScannedFiles(filePaths)}
            onChangePath={resetImport}
            onBack={() => setTokensPath(undefined)}
          />
        );
      }
      if (extractionRun) {
        if (extraction?.status === 'done' && !extraction.result.ok) {
          return (
            <ErrorStep stepName={extraction.result.step} message={extraction.result.message} onExit={leaveImport} />
          );
        }
        if (extraction?.status === 'running') {
          return (
            <ExtractionScreen
              progress={extraction.progress}
              agent={extractionRun.input.agent}
              {...stepNumbers({ hasRawTokens: extractionRun.input.rawTokensPath !== '' })}
            />
          );
        }
        return <></>;
      }
      if (scopeRun && scopeFlow) {
        if (scopeFlow.status === 'failed') {
          return <ErrorStep stepName="scope gate" message={scopeFlow.message} onExit={leaveImport} />;
        }
        if (scopeFlow.status === 'deciding') {
          return (
            <ScopeGateScreen
              key={scopeRun.extraction.sessionId}
              components={scopeFlow.load.components}
              savedDecisions={scopeFlow.load.savedDecisions}
              onConfirm={scopeFlow.confirm}
              onQuit={leaveImport}
            />
          );
        }
        if (generation?.status === 'done' && !generation.result.ok) {
          return (
            <ErrorStep stepName={generation.result.step} message={generation.result.message} onExit={leaveImport} />
          );
        }
        if (generation?.status === 'running') {
          // the generating step comes right after extraction; the count grows by one once token mapping is known to run
          const hasRawTokens = scopeRun.input.rawTokensPath !== '';
          const counted = stepNumbers({
            hasRawTokens,
            mapTokensEligible: generation.progress.mapTokensEligible,
          });
          return (
            <GenerationScreen
              progress={generation.progress}
              agent={scopeRun.input.agent}
              acceptedCount={scopeFlow.decisions.accepted.length}
              hasTokens={scopeRun.extraction.tokensPath !== ''}
              stepNumber={hasRawTokens ? 4 : 3}
              totalSteps={counted.totalSteps}
            />
          );
        }
        return <></>;
      }
      if (pendingLaunch?.cached) {
        return (
          <TokenReuseScreen
            tokensPath={pendingLaunch.cached.tokensPath}
            sourceChanged={pendingLaunch.cached.sourceChanged}
            onReuse={() => chooseTokenStrategy(pendingLaunch, 'reuse')}
            onRegenerate={() => chooseTokenStrategy(pendingLaunch, 'regenerate')}
            onQuit={leaveImport}
          />
        );
      }
      return (
        <CredentialsScreen
          initial={importDefaults.credentials}
          onBack={() => setScannedFiles(undefined)}
          onDone={(result) => void trackImportWork(finishCredentials(result, projectPath, tokensPath, scannedFiles))}
        />
      );
    case 'help':
      return <HelpScreen onDone={goToStart} />;
    case 'upgrade':
      return <UpgradeScreen onDone={goToStart} />;
    case 'settings':
      return <SettingsScreen onNavigate={setScreen} onBack={goToStart} />;
    case 'settings-configuration':
      return <ConfigurationScreen onDone={goToSettings} />;
    case 'settings-opt-in-analytics':
      return <OptInAnalyticsScreen onDone={goToSettings} />;
    case 'settings-debug-mode':
      return <DebugModeScreen onDone={goToSettings} />;
    case 'start':
      return <HomeScreen onNavigate={setScreen} />;
  }
}

export async function runApp(
  renderApp: (element: React.ReactElement) => { waitUntilExit: () => Promise<unknown>; clear?: () => void },
  importOptions: ImportOptions,
): Promise<void> {
  const inkClear = (): void => {
    // ink.clear() resets ink's own frame-height bookkeeping but doesn't erase stale terminal characters.
    // \x1b[H moves cursor home, \x1b[0J erases from cursor to end of screen — leaves scrollback intact.
    instance.clear?.();
    process.stdout.write('\x1b[H\x1b[0J');
  };
  const instance = renderApp(<App importOptions={importOptions} inkClear={inkClear} />);
  await instance.waitUntilExit();
}
