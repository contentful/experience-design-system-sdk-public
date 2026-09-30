import React from 'react';
import { ToggleSettingScreen } from '../ToggleSettingScreen.js';
import { readAnalyticsSetting, writeAnalyticsSetting } from './analytics-store.js';

const DESCRIPTION = [
  'Shares which CLI commands are used and where imports succeed or fail.',
  'Never includes source code, file paths, credentials, or authored content.',
] as const;

export function OptInAnalyticsScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  return (
    <ToggleSettingScreen
      title="Settings › Opt-in Analytics"
      label="Share anonymous usage data"
      description={DESCRIPTION}
      read={readAnalyticsSetting}
      write={writeAnalyticsSetting}
      onDone={onDone}
    />
  );
}
