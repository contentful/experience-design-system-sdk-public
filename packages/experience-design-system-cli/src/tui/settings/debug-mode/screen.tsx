import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../../home/home.theme.js';
import { readDebugModeSetting, writeDebugModeSetting } from './debug-mode-store.js';
import { startDebugRun, finishDebugRun } from '../../debug-store.js';
import { ControlHints } from '../../control-hints.js';

export function DebugModeScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    readDebugModeSetting().then((setting) => {
      setEnabled(setting.enabled);
      setLoading(false);
      startDebugRun({
        flow: 'settings/debug-mode',
        step: '01-debug-mode',
        menuOption: 'Debug Mode',
        inputs: { enabled: setting.enabled },
      });
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
      void finishDebugRun({ outputs: { enabled }, status: 'success', exitMethod: 'saved' });
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
      <ControlHints
        hints={[
          { keys: '⏎/Space', label: 'toggle' },
          { keys: 'Esc/q', label: 'back' },
        ]}
      />
    </Box>
  );
}
