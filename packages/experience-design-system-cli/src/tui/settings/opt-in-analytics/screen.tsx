import React from 'react';
import { Text } from 'ink';
import { PALETTE } from '../../theme.js';
import { PreferenceScreen } from '../PreferenceScreen.js';
import { readAnalyticsSetting, writeAnalyticsSetting } from './analytics-store.js';
export function OptInAnalyticsScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  return (
    <PreferenceScreen
      title="Settings › Opt-in Analytics"
      label="Share anonymous usage data"
      flow="settings/opt-in-analytics"
      step="01-opt-in-analytics"
      menuOption="Opt-in Analytics"
      read={readAnalyticsSetting}
      write={writeAnalyticsSetting}
      onDone={onDone}
      description={
        <>
          <Text> </Text>
          <Text color={PALETTE.muted}>Shares which CLI commands are used and where imports succeed or fail.</Text>
          <Text color={PALETTE.muted}>Never includes source code, file paths, credentials, or authored content.</Text>
        </>
      }
    />
  );
}
