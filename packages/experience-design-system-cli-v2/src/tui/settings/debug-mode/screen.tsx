import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../../home/home.theme.js';
import { readDebugModeSetting, writeDebugModeSetting } from './debug-mode-store.js';

export function DebugModeScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    readDebugModeSetting().then((setting) => {
      setEnabled(setting.enabled);
      setLoading(false);
    });
  }, []);

  useInput((input, key) => {
    if (loading) return;

    if (key.return || input === ' ') {
      setEnabled((current) => {
        const next = !current;
        void writeDebugModeSetting({ enabled: next });
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
      <Text bold>Settings › Debug Mode</Text>
      <Text> </Text>
      {loading ? (
        <Text color={PALETTE.muted}>Loading…</Text>
      ) : (
        <Text>
          Debug logging:{' '}
          <Text bold color={enabled ? PALETTE.success : PALETTE.muted}>
            {enabled ? 'On' : 'Off'}
          </Text>
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>[Enter/Space] Toggle [Esc/q] Back to Settings</Text>
    </Box>
  );
}
