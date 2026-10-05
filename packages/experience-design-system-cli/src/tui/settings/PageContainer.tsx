import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Screen } from '../../../app.js';
import { startDebugRun, finishDebugRun } from '../debug-store.js';

export function SettingsScreen({
  onNavigate,
  onBack,
}: {
  onNavigate: (screen: Screen) => void;
  onBack: () => void;
}): React.ReactElement {
  const [focusIdx, setFocusIdx] = useState(0);
  const items: { label: string; screen?: Screen }[] = [
    { label: 'Configuration', screen: 'settings-configuration' },
    { label: 'Opt-in Analytics', screen: 'settings-opt-in-analytics' },
    { label: 'Debug Mode', screen: 'settings-debug-mode' },
  ];

  useEffect(() => {
    startDebugRun({
      flow: 'settings',
      step: '01-settings',
      menuOption: 'Settings',
      inputs: { options: items.map((item) => item.label) },
    });
  }, []);

  useInput((input, key) => {
    if (key.upArrow) {
      setFocusIdx((i) => (i - 1 + items.length) % items.length);
      return;
    }
    if (key.downArrow) {
      setFocusIdx((i) => (i + 1) % items.length);
      return;
    }
    if (key.return) {
      const screen = items[focusIdx]!.screen;
      if (screen) {
        void finishDebugRun({
          outputs: { selected: items[focusIdx]!.label },
          status: 'success',
          exitMethod: 'saved',
        });
        onNavigate(screen);
      }
      return;
    }
    if (key.escape || input === 'q') {
      void finishDebugRun({ outputs: {}, status: 'success', exitMethod: 'discarded' });
      onBack();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings</Text>
      <Text> </Text>
      {items.map((item, i) => (
        <Text key={item.label} color={i === focusIdx ? 'cyan' : undefined}>
          {i === focusIdx ? '> ' : '  '}
          {item.label}
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>[↑/↓] Navigate [Enter] Select [Esc/q] Back to Start</Text>
    </Box>
  );
}
