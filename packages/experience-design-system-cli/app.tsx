import React, { useEffect, useState } from 'react';
import { HomeScreen } from './src/tui/home/home.js';
import { ImportScreen } from './src/tui/import/PageContainer.js';
import { TokenInputScreen, WelcomeScreen } from './src/tui/import/steps/index.js';
import type { SpawnV1ImportOptions } from './src/tui/import/spawn-v1-import.js';
import { spawnV1Import } from './src/tui/import/spawn-v1-import.js';
import { startReadingTerminal, stopReadingTerminal } from './src/tui/import/terminal-input.js';
import { HelpScreen } from './src/tui/help/PageContainer.js';
import { SettingsScreen } from './src/tui/settings/PageContainer.js';
import { ConfigurationScreen } from './src/tui/settings/contentful-configuration/ContentfulConfigScreen.js';
import { OptInAnalyticsScreen } from './src/tui/settings/opt-in-analytics/screen.js';
import { UpgradeScreen } from './src/tui/upgrade/PageContainer.js';
import { DebugModeScreen } from './src/tui/settings/debug-mode/screen.js';
import { readCredentials } from './src/tui/settings/contentful-configuration/config-store.js';

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
  const [importDefaults, setImportDefaults] = useState<{ componentDir: string; tokenFile: string }>();

  // Read the saved defaults each time the import flow opens, so a change in Settings shows up right away.
  // The screens only read their initial value on mount, so they wait for this to resolve.
  useEffect(() => {
    if (screen !== 'import') {
      setImportDefaults(undefined);
      return;
    }
    void readCredentials().then((saved) =>
      setImportDefaults({ componentDir: saved.defaultComponentDir ?? '', tokenFile: saved.defaultTokenFile ?? '' }),
    );
  }, [screen]);

  const goToStart = (): void => setScreen('start');
  const goToSettings = (): void => setScreen('settings');

  const finishImportResult = (): void => {
    setShowImportResult(false);
    setProjectPath(undefined);
    goToStart();
  };

  const leaveImport = (): void => {
    setProjectPath(undefined);
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
      return (
        <TokenInputScreen
          initialPath={importDefaults.tokenFile}
          onConfirm={(tokens) => onLaunchImport?.({ project: projectPath, tokens })}
          onSkip={() => onLaunchImport?.({ project: projectPath })}
          onBack={() => setProjectPath(undefined)}
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
