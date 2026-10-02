import React, { useState } from 'react';
import { HomeScreen } from './src/tui/home/home.js';
import { ImportScreen } from './src/tui/import/PageContainer.js';
import { spawnV1Import } from './src/tui/import/spawn-v1-import.js';
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

export interface AppProps {
  /** Called when the user picks Import; the host unmounts the app and runs v1. */
  onLaunchImport?: () => void;
  /** Set when returning from a v1 import run; opens the result screen. */
  importExitCode?: number;
}

export function App({ onLaunchImport, importExitCode }: AppProps): React.ReactElement {
  const [screen, setScreen] = useState<Screen>(importExitCode === undefined ? 'start' : 'import');
  const navigate = (next: Screen): void => {
    if (next === 'import' && onLaunchImport) {
      onLaunchImport();
      return;
    }
    setScreen(next);
  };

  if (screen === 'import') {
    return <ImportScreen exitCode={importExitCode} onDone={() => setScreen('start')} />;
  }
  if (screen === 'help') {
    return <HelpScreen onDone={() => setScreen('start')} />;
  }
  if (screen === 'settings') {
    return <SettingsScreen onNavigate={setScreen} onBack={() => setScreen('start')} />;
  }
  if (screen === 'settings-configuration') {
    return <ConfigurationScreen onDone={() => setScreen('settings')} />;
  }
  if (screen === 'settings-opt-in-analytics') {
    return <OptInAnalyticsScreen onDone={() => setScreen('settings')} />;
  }
  if (screen === 'settings-debug-mode') {
    return <DebugModeScreen onDone={() => setScreen('settings')} />;
  }
  if (screen === 'upgrade') {
    return <UpgradeScreen onDone={() => setScreen('start')} />;
  }

  return <HomeScreen onNavigate={navigate} />;
}

interface AppInstance {
  unmount: () => void;
  waitUntilExit: () => Promise<unknown>;
}

/**
 * Runs the v2 app. When the user picks Import, the app is fully unmounted and v1
 * runs with the terminal to itself; then the app is re-rendered on the result screen.
 * `renderApp` is the host's Ink render function, so each entry point keeps its own
 * render options.
 */
export async function runApp(renderApp: (element: React.ReactElement) => AppInstance): Promise<void> {
  let importExitCode: number | undefined;
  for (;;) {
    let launchImport = false;
    const instance: AppInstance = renderApp(
      <App
        importExitCode={importExitCode}
        onLaunchImport={() => {
          launchImport = true;
          instance.unmount();
        }}
      />,
    );
    await instance.waitUntilExit();
    if (!launchImport) return;

    // v1 inherits the terminal, so v2's Ink app must be fully unmounted while it
    // runs. Otherwise both read the same stdin and keypresses get split.
    importExitCode = (await spawnV1Import({})).exitCode;
  }
}
