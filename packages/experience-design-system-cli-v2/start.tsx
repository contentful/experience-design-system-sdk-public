import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Screen } from './app.js';
import { FOCUS_MARKER, FRAME_BORDER_STYLE, PALETTE } from './src/tui/theme.js';
import { readPackageVersion } from './src/tui/version.js';

const VERSION = readPackageVersion();

const START_ITEMS: { label: string; hint: string; screen: Screen | 'exit' }[] = [
  { label: 'Import', hint: 'Extract components and push them to Contentful', screen: 'import' },
  { label: 'Saved Runs', hint: 'Review or replay a previous import', screen: 'saved-runs' },
  { label: 'Upgrade', hint: 'Update to the latest version', screen: 'upgrade' },
  { label: 'Settings', hint: 'Configuration and analytics', screen: 'settings' },
  { label: 'Help', hint: 'Docs and keyboard shortcuts', screen: 'help' },
  { label: 'Exit', hint: 'Leave the TUI', screen: 'exit' },
];

/** Widest label, so the hint column lines up without hardcoding a magic number. */
const LABEL_WIDTH = Math.max(...START_ITEMS.map((item) => item.label.length));

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
      <Box borderStyle={FRAME_BORDER_STYLE} borderColor={PALETTE.border} flexDirection="column" paddingX={2}>
        <Text bold color={PALETTE.accent}>
          Contentful Experiences
        </Text>
        <Box>
          <Text color={PALETTE.muted}>Design System Import</Text>
          <Text color={PALETTE.muted}> · v{VERSION}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {START_ITEMS.map((item, i) => {
          const focused = i === focusIdx;
          return (
            // One Text per row, truncating as a whole: a wrapped hint would push a
            // continuation line under the label column and break the alignment.
            <Text key={item.label} wrap="truncate-end">
              <Text bold={focused} color={focused ? PALETTE.accent : undefined}>
                {focused ? `${FOCUS_MARKER} ` : '  '}
                {item.label.padEnd(LABEL_WIDTH)}
              </Text>
              <Text color={PALETTE.muted}> {item.hint}</Text>
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={PALETTE.muted}>↑/↓ move · </Text>
        <Text color={PALETTE.muted}>⏎ select · </Text>
        <Text color={PALETTE.muted}>q quit</Text>
      </Box>
    </Box>
  );
}
