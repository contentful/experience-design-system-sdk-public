import { join } from 'node:path';
import React, { useEffect, useState } from 'react';
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
import { ErrorStep, RunningStep } from './src/tui/import/shared/index.js';
import { resolveAgentChoice, stepNumbers } from './src/tui/import/steps/06-extraction/logic.js';
import { readSettings } from '@contentful/experience-design-system-types/config';
import { useExtraction } from './src/tui/import/steps/06-extraction/use-extraction.js';
import { ScopeGateScreen } from './src/tui/import/steps/07-scope-gate/screen.js';
import { useScopeGateFlow } from './src/tui/import/steps/07-scope-gate/use-scope-gate-flow.js';
import type { ExtractionHandoff } from '@contentful/experience-design-system-types/handoff';
import type { ExtractionInput } from './src/tui/import/steps/06-extraction/types.js';
import { inspectTokens, type TokenStrategy } from './src/tui/import/steps/05-token-reuse/logic.js';
import { resolveUserPath } from './src/tui/import/resolve-user-path.js';
import type { CredentialsResult } from './src/tui/import/steps/04-credentials/screen.js';
import type { ImportOptions } from './src/commands/import-options.js';
import type { SpawnV1ImportOptions } from './src/tui/import/spawn-v1-import.js';
import { spawnV1Import } from './src/tui/import/spawn-v1-import.js';
import { startReadingTerminal, stopReadingTerminal } from './src/tui/import/terminal-input.js';
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

export type Screen =
  | 'start'
  | 'import'
  | 'help'
  | 'settings'
  | 'settings-configuration'
  | 'settings-opt-in-analytics'
  | 'settings-debug-mode'
  | 'upgrade';

interface PendingLaunch {
  launch: SpawnV1ImportOptions;
  credentials: CredentialsResult;
  cached?: { tokensPath: string; sourceChanged: boolean };
}

interface ExtractionRun {
  launch: SpawnV1ImportOptions;
  credentialsSkipped: boolean;
  tokenStrategy: TokenStrategy;
  input: ExtractionInput;
}

// Set once extraction has produced a session; the scope gate runs for it before the legacy wizard starts.
interface ScopeRun {
  launch: SpawnV1ImportOptions;
  credentialsSkipped: boolean;
  tokenStrategy: TokenStrategy;
  input: ExtractionInput;
  extraction: ExtractionHandoff;
}

interface AppProps {
  importOptions: ImportOptions;
  onLaunchImport?: (options: SpawnV1ImportOptions) => void;
  importExitCode?: number;
}

function App({ importOptions, onLaunchImport, importExitCode }: AppProps): React.ReactElement {
  const returnedFromImport = importExitCode !== undefined;
  const [screen, setScreen] = useState<Screen>(returnedFromImport ? 'import' : 'start');
  const [showImportResult, setShowImportResult] = useState(returnedFromImport);
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
  const [importDefaults, setImportDefaults] = useState<{
    componentDir: string;
    tokenFile: string;
    credentials: V1Credentials;
  }>();

  // Read the saved defaults each time the import flow opens, so a change in Settings shows up right away.
  // The screens only read their initial value on mount, so they wait for this to resolve.
  useEffect(() => {
    if (screen !== 'import') {
      setImportDefaults(undefined);
      return;
    }
    void readCredentials().then((saved) =>
      setImportDefaults({
        componentDir: saved.defaultComponentDir ?? '',
        tokenFile: saved.defaultTokenFile ?? '',
        credentials: saved,
      }),
    );
  }, [screen]);

  const finishCredentials = async (
    result: CredentialsResult,
    projectPath: string,
    tokens: string,
    filePaths: string[],
  ): Promise<void> => {
    if (!result.skipped) await writeCredentials({ ...result.credentials });
    const launch: SpawnV1ImportOptions = { projectPath, tokens, filePaths, ...importOptions };
    // legacy keeps its output next to the project, so the existing token catalog is looked up there
    const state = await inspectTokens({
      rawTokensPath: tokens,
      outDir: join(resolveUserPath(projectPath), '.contentful'),
      cache: importOptions.cache,
    });
    if (state.kind === 'cached') {
      setPendingLaunch({
        launch,
        credentials: result,
        cached: { tokensPath: state.tokensPath, sourceChanged: state.sourceChanged },
      });
      return;
    }
    await startExtraction(launch, 'generate', result);
  };

  const chooseTokenStrategy = (pending: PendingLaunch, tokenStrategy: TokenStrategy): void => {
    setPendingLaunch(undefined);
    void startExtraction(pending.launch, tokenStrategy, pending.credentials);
  };

  const startExtraction = async (
    launch: SpawnV1ImportOptions,
    tokenStrategy: TokenStrategy,
    credentials: CredentialsResult,
  ): Promise<void> => {
    const { agent, agentModel } = resolveAgentChoice(launch.agent, await readSettings());
    setExtractionRun({
      // the wizard gets the same agent, so its later steps use what the stage used
      launch: { ...launch, agent: agentModel ? `${agent}:${agentModel}` : agent },
      credentialsSkipped: credentials.skipped,
      tokenStrategy,
      input: {
        projectPath: resolveUserPath(launch.projectPath ?? ''),
        rawTokensPath: launch.tokens ?? '',
        tokenStrategy,
        credentials: credentials.skipped ? null : credentials.credentials,
        agent,
        ...(agentModel ? { agentModel } : {}),
        promptOverrides: launch.prompt ?? [],
        noCache: launch.cache === false,
      },
    });
  };

  // A finished extraction opens the scope gate, once, with what the stage produced.
  useEffect(() => {
    if (!extractionRun || extraction?.status !== 'done' || !extraction.result.ok) return;
    setExtractionRun(undefined);
    setScopeRun({ ...extractionRun, extraction: extraction.result.extraction });
  }, [extraction, extractionRun]);

  // A confirmed scope launches the legacy wizard exactly once, with the extraction and the decisions.
  useEffect(() => {
    if (!scopeRun || scopeFlow?.status !== 'confirmed') return;
    const { launch, credentialsSkipped, tokenStrategy, extraction: produced } = scopeRun;
    setScopeRun(undefined);
    onLaunchImport?.({
      ...launch,
      handoff: {
        credentialsSkipped,
        tokens: { strategy: tokenStrategy },
        extraction: produced,
        scope: scopeFlow.scope,
      },
    });
  }, [scopeFlow, scopeRun]);

  const goToStart = (): void => setScreen('start');
  const goToSettings = (): void => setScreen('settings');

  const resetImport = (): void => {
    setProjectPath(undefined);
    setTokensPath(undefined);
    setScannedFiles(undefined);
    setPendingLaunch(undefined);
    setExtractionRun(undefined);
    setScopeRun(undefined);
  };

  const finishImportResult = (): void => {
    setShowImportResult(false);
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
              components={scopeFlow.load.components}
              onConfirm={scopeFlow.confirm}
              onQuit={leaveImport}
            />
          );
        }
        // Confirmed before the cache check finished. It is the step after extraction in the same count.
        const numbers = stepNumbers({ hasRawTokens: scopeRun.input.rawTokensPath !== '' });
        return (
          <RunningStep
            stepNumber={numbers.stepNumber + 1}
            totalSteps={numbers.totalSteps}
            title="Preparing"
            description="Checking which components are already generated..."
          />
        );
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
          onDone={(result) => void finishCredentials(result, projectPath, tokensPath, scannedFiles)}
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

interface AppInstance {
  unmount: () => void;
  waitUntilExit: () => Promise<unknown>;
}

// Erase the visible screen and move the cursor home; scrollback is kept.
const CLEAR_SCREEN = '\u001B[2J\u001B[H';

type RenderApp = (element: React.ReactElement) => AppInstance;

async function renderUntilImportRequestedOrExit(
  renderApp: RenderApp,
  importOptions: ImportOptions,
  importExitCode: number | undefined,
): Promise<SpawnV1ImportOptions | undefined> {
  let requestedImport: SpawnV1ImportOptions | undefined;

  const instance: AppInstance = renderApp(
    <App
      importOptions={importOptions}
      importExitCode={importExitCode}
      onLaunchImport={(options) => {
        requestedImport = options;
        instance.unmount();
      }}
    />,
  );
  await instance.waitUntilExit();
  await stopReadingTerminal();

  // Ink keeps the last frame on screen after unmount. Wipe it so the v1 legacy
  // wizard replaces this screen instead of rendering below it.
  if (requestedImport !== undefined && process.stdout.isTTY) {
    process.stdout.write(CLEAR_SCREEN);
  }

  return requestedImport;
}

export async function runApp(renderApp: RenderApp, importOptions: ImportOptions): Promise<void> {
  let importExitCode: number | undefined;

  let requestedImport = await renderUntilImportRequestedOrExit(renderApp, importOptions, importExitCode);
  while (requestedImport !== undefined) {
    importExitCode = (await spawnV1Import(requestedImport)).exitCode;
    startReadingTerminal();
    requestedImport = await renderUntilImportRequestedOrExit(renderApp, importOptions, importExitCode);
  }
}
