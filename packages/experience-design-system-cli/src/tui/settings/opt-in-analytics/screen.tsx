import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../../home/home.theme.js';
import { readAnalyticsSetting, writeAnalyticsSetting } from './analytics-store.js';

export function OptInAnalyticsScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    readAnalyticsSetting().then((setting) => {
      setEnabled(setting.enabled);
      setLoading(false);
    });
  }, []);

  useInput((input, key) => {
    if (loading) return;

    if (key.return || input === ' ') {
      setEnabled((current) => {
        const next = !current;
        void writeAnalyticsSetting({ enabled: next });
        return next;
      });
      return;
    }
    if (key.escape || input === 'q') {
      onDone();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings › Opt-in Analytics</Text>
      <Text> </Text>
      {loading ? (
        <Text color={PALETTE.muted}>Loading…</Text>
      ) : (
        <>
          <Text>
            Share anonymous usage data:{' '}
            <Text bold color={enabled ? PALETTE.success : PALETTE.muted}>
              {enabled ? 'On' : 'Off'}
            </Text>
          </Text>
          <Text> </Text>
          <Text dimColor>Shares which CLI commands are used and where imports succeed or fail.</Text>
          <Text dimColor>Never includes source code, file paths, credentials, or authored content.</Text>
        </>
      )}
      <Text> </Text>
      <Text dimColor>[Enter/Space] Toggle [Esc/q] Back to Settings</Text>
    </Box>
  );
}
