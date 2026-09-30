import React from 'react';
import { ToggleSettingScreen } from '../ToggleSettingScreen.js';
import { readDebugModeSetting, writeDebugModeSetting } from './debug-mode-store.js';

export function DebugModeScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  return (
    <ToggleSettingScreen
      title="Settings › Debug Mode"
      label="Debug logging"
      read={readDebugModeSetting}
      write={writeDebugModeSetting}
      onDone={onDone}
    />
  );
}
