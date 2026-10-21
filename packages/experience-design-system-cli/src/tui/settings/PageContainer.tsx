import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Screen } from '../../../app.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { PALETTE } from '../theme.js';

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
        onNavigate(screen);
      }
      return;
    }
    if (key.escape || input === 'q') {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings</Text>
      <Text color={PALETTE.muted}> </Text>
      {items.map((item, i) => (
        <Text key={item.label} color={i === focusIdx ? PALETTE.accent : undefined}>
          {i === focusIdx ? '> ' : '  '}
          {item.label}
        </Text>
      ))}
      <Text> </Text>
      <ControlHints
        hints={[
          { keys: '↑/↓', label: 'move' },
          { keys: '⏎', label: 'select' },
          { keys: 'Esc/q', label: 'back' },
        ]}
      />
    </Box>
  );
}
