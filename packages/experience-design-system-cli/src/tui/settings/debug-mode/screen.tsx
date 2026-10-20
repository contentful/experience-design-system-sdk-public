import React from 'react';
import { PreferenceScreen } from '../PreferenceScreen.js';
import { readDebugModeSetting, writeDebugModeSetting } from './debug-mode-store.js';
export function DebugModeScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  return (
    <PreferenceScreen
      title="Settings › Debug Mode"
      label="Debug logging"
      flow="settings/debug-mode"
      step="01-debug-mode"
      menuOption="Debug Mode"
      read={readDebugModeSetting}
      write={writeDebugModeSetting}
      onDone={onDone}
    />
  );
}
