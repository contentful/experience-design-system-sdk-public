import React, { useState } from 'react';
import { StartScreen } from './start.js';
import { ImportScreen } from './src/import/screen.js';
import { SavedRunsScreen } from './src/saved-runs/screen.js';
import { HelpScreen } from './src/help/screen.js';
import { SettingsScreen } from './src/settings/screen.js';
import { OptInAnalyticsScreen } from './src/settings/opt-in-analytics/screen.js';
import { ConfigurationScreen } from './src/settings/push-configuration/screen.js';

export type Screen =
  | 'start'
  | 'import'
  | 'saved-runs'
  | 'help'
  | 'settings'
  | 'settings-opt-in-analytics'
  | 'settings-configuration';

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
    return <ConfigurationScreen onDone={() => setScreen('settings')} />;
  }

  return <StartScreen onNavigate={setScreen} />;
}
