import React, { useState } from 'react';
import { HomeScreen } from './src/tui/home/home.js';
import { ImportScreen } from './src/tui/import/PageContainer.js';
import { SavedRunsScreen } from './src/tui/saved-runs/PageContainer.js';
import { HelpScreen } from './src/tui/help/PageContainer.js';
import { SettingsScreen } from './src/tui/settings/PageContainer.js';
import { OptInAnalyticsScreen } from './src/tui/settings/opt-in-analytics/screen.js';
import { ConfigurationScreen } from './src/tui/settings/contentful-configuration/screen.js';
import { UpgradeScreen } from './src/tui/upgrade/PageContainer.js';

export type Screen =
  | 'start'
  | 'import'
  | 'saved-runs'
  | 'help'
  | 'settings'
  | 'settings-opt-in-analytics'
  | 'settings-configuration'
  | 'upgrade';

export function App(): React.ReactElement {
  const [screen, setScreen] = useState<Screen>('start');

  if (screen === 'import') {
    return <ImportScreen onDone={() => setScreen('start')} />;
  }
  if (screen === 'saved-runs') {
    return <SavedRunsScreen onDone={() => setScreen('start')} />;
  }
  if (screen === 'help') {
    return <HelpScreen onDone={() => setScreen('start')} />;
  }
  if (screen === 'settings') {
    return <SettingsScreen onNavigate={setScreen} onBack={() => setScreen('start')} />;
  }
  if (screen === 'settings-opt-in-analytics') {
    return <OptInAnalyticsScreen onDone={() => setScreen('settings')} />;
  }
  if (screen === 'settings-configuration') {
    return <ConfigurationScreen onDone={() => setScreen('start')} />;
  }
  if (screen === 'upgrade') {
    return <UpgradeScreen onDone={() => setScreen('start')} />;
  }

  return <HomeScreen onNavigate={setScreen} />;
}
