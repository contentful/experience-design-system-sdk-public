import React, { useState } from 'react';
import { HomeScreen } from './src/tui/home/home.js';
import { ImportScreen } from './src/tui/import/PageContainer.js';
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
