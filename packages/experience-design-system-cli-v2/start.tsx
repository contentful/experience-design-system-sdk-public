import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Screen } from './app.js';

const START_ITEMS: { label: string; screen: Screen | 'exit' }[] = [
  { label: 'Import', screen: 'import' },
  { label: 'Saved Runs', screen: 'saved-runs' },
  { label: 'Settings', screen: 'settings' },
  { label: 'Help', screen: 'help' },
  { label: 'Exit', screen: 'exit' },
];

export function StartScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }): React.ReactElement {
  const [focusIdx, setFocusIdx] = useState(0);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.upArrow) {
      setFocusIdx((i) => (i - 1 + START_ITEMS.length) % START_ITEMS.length);
      return;
    }
    if (key.downArrow) {
      setFocusIdx((i) => (i + 1) % START_ITEMS.length);
      return;
    }
    if (key.return) {
      const chosen = START_ITEMS[focusIdx]!;
      if (chosen.screen === 'exit') {
        exit();
        return;
      }
      onNavigate(chosen.screen);
      return;
    }
    if (input === 'q' || key.escape) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Contentful Experiences — Import v2</Text>
      <Text> </Text>
      {START_ITEMS.map((item, i) => (
        <Text key={item.label} color={i === focusIdx ? 'cyan' : undefined}>
          {i === focusIdx ? '> ' : '  '}
          {item.label}
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>[↑/↓] Navigate [Enter] Select [Esc/q] Quit</Text>
    </Box>
  );
}
