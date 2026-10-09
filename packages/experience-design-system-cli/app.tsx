import React, { useEffect, useState } from 'react';
import { HomeScreen } from './src/tui/home/home.js';
import { ImportScreen } from './src/tui/import/PageContainer.js';
import {
  CredentialsScreen,
  PathValidationScreen,
  TokenInputScreen,
  WelcomeScreen,
} from './src/tui/import/steps/index.js';
import type { CredentialsResult } from './src/tui/import/steps/04-credentials/screen.js';
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

interface AppProps {
  onLaunchImport?: (options: SpawnV1ImportOptions) => void;
  importExitCode?: number;
}

function App({ onLaunchImport, importExitCode }: AppProps): React.ReactElement {
  const returnedFromImport = importExitCode !== undefined;
  const [screen, setScreen] = useState<Screen>(returnedFromImport ? 'import' : 'start');
  const [showImportResult, setShowImportResult] = useState(returnedFromImport);
  const [projectPath, setProjectPath] = useState<string>();
  const [tokensPath, setTokensPath] = useState<string>();
  const [pathConfirmed, setPathConfirmed] = useState(false);
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

  const finishCredentials = async (result: CredentialsResult, project: string, tokens: string): Promise<void> => {
    if (!result.skipped) await writeCredentials({ ...result.credentials });
    onLaunchImport?.({ project, tokens, skipCredentials: result.skipped });
  };

  const goToStart = (): void => setScreen('start');
  const goToSettings = (): void => setScreen('settings');

  const resetImport = (): void => {
    setProjectPath(undefined);
    setTokensPath(undefined);
    setPathConfirmed(false);
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
      if (!pathConfirmed) {
        return (
          <PathValidationScreen
            projectPath={projectPath}
            onConfirm={() => setPathConfirmed(true)}
            onChangePath={resetImport}
            onBack={() => setTokensPath(undefined)}
          />
        );
      }
      return (
        <CredentialsScreen
          initial={importDefaults.credentials}
          onBack={() => setPathConfirmed(false)}
          onDone={(result) => void finishCredentials(result, projectPath, tokensPath)}
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
  importExitCode: number | undefined,
): Promise<SpawnV1ImportOptions | undefined> {
  let requestedImport: SpawnV1ImportOptions | undefined;

  const instance: AppInstance = renderApp(
    <App
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

export async function runApp(renderApp: RenderApp): Promise<void> {
  let importExitCode: number | undefined;

  let requestedImport = await renderUntilImportRequestedOrExit(renderApp, importExitCode);
  while (requestedImport !== undefined) {
    importExitCode = (await spawnV1Import(requestedImport)).exitCode;
    startReadingTerminal();
    requestedImport = await renderUntilImportRequestedOrExit(renderApp, importExitCode);
  }
}
