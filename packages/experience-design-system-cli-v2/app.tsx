import React, { useState } from 'react';
import { HomeScreen } from './src/tui/home/home.js';
import { ImportScreen } from './src/tui/import/PageContainer.js';
import { spawnV1Import } from './src/tui/import/spawn-v1-import.js';
import { startReadingTerminal, stopReadingTerminal } from './src/tui/import/terminal-input.js';
import { HelpScreen } from './src/tui/help/PageContainer.js';
import { SettingsScreen } from './src/tui/settings/PageContainer.js';
import { ConfigurationScreen } from './src/tui/settings/contentful-configuration/ContentfulConfigScreen.js';
import { OptInAnalyticsScreen } from './src/tui/settings/opt-in-analytics/screen.js';
import { UpgradeScreen } from './src/tui/upgrade/PageContainer.js';
import { DebugModeScreen } from './src/tui/settings/debug-mode/screen.js';

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
  onLaunchImport?: () => void;
  importExitCode?: number;
}

function App({ onLaunchImport, importExitCode }: AppProps): React.ReactElement {
  const returnedFromImport = importExitCode !== undefined;
  const [screen, setScreen] = useState<Screen>(returnedFromImport ? 'import' : 'start');

  const goToStart = (): void => setScreen('start');
  const goToSettings = (): void => setScreen('settings');

  const navigateFromHome = (next: Screen): void => {
    if (next === 'import' && onLaunchImport) {
      onLaunchImport();
      return;
    }
    setScreen(next);
  };

  switch (screen) {
    case 'import':
      return <ImportScreen exitCode={importExitCode} onDone={goToStart} />;
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
      return <HomeScreen onNavigate={navigateFromHome} />;
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
): Promise<boolean> {
  let importRequested = false;

  const instance: AppInstance = renderApp(
    <App
      importExitCode={importExitCode}
      onLaunchImport={() => {
        importRequested = true;
        instance.unmount();
      }}
    />,
  );
  await instance.waitUntilExit();
  await stopReadingTerminal();

  return importRequested;
}

export async function runApp(renderApp: RenderApp): Promise<void> {
  let importExitCode: number | undefined;

  while (await renderUntilImportRequestedOrExit(renderApp, importExitCode)) {
    importExitCode = (await spawnV1Import({})).exitCode;
    startReadingTerminal();
  }
}
