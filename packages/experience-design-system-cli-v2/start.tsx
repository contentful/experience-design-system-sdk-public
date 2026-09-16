import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Screen } from './app.js';
import { FOCUS_MARKER, PALETTE, brandBar } from './src/tui/styles/theme.js';
import { readPackageVersion } from './src/tui/version.js';
import { useTerminalWidth } from './src/tui/use-terminal-width.js';

const VERSION = readPackageVersion();
const HEADING = 'Contentful Experiences';
const SUBTITLE = "Let's import your design system into Contentful";

/** Width the layout needs: longest line plus side padding. */
const LAYOUT_COLUMNS = 41;

/** 4x the layout's needs, so this gates a default 80-column terminal. */
export const MIN_COLUMNS = LAYOUT_COLUMNS * 4;

const START_ITEMS: { label: string; screen: Screen }[] = [
  { label: 'Import', screen: 'import' },
  { label: 'Saved Runs', screen: 'saved-runs' },
  { label: 'Upgrade Version', screen: 'upgrade' },
  { label: 'Settings', screen: 'settings' },
  { label: 'Help', screen: 'help' },
];

export function StartScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }): React.ReactElement {
  const [focusIdx, setFocusIdx] = useState(0);
  const { exit } = useApp();
  const terminalWidth = useTerminalWidth();
  const tooNarrow = terminalWidth < MIN_COLUMNS;

  useInput((input, key) => {
    // Quitting works from the too-narrow notice; menu keys do not apply there.
    if (input === 'q' || key.escape) {
      exit();
      return;
    }
    if (tooNarrow) return;

    if (key.upArrow) {
      setFocusIdx((i) => (i - 1 + START_ITEMS.length) % START_ITEMS.length);
      return;
    }
    if (key.downArrow) {
      setFocusIdx((i) => (i + 1) % START_ITEMS.length);
      return;
    }
    if (key.return) {
      onNavigate(START_ITEMS[focusIdx]!.screen);
      return;
    }
  });

  if (tooNarrow) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color={PALETTE.warning}>
          Terminal too small
        </Text>
        {/* Split in two so it does not wrap on the terminals that trigger it. */}
        <Text color={PALETTE.muted}>Use full screen</Text>
        <Text color={PALETTE.muted}>for the best experience</Text>
        <Text color={PALETTE.muted}>q quit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="column" alignItems="center">
        <Text bold color={PALETTE.heading}>
          {HEADING}
        </Text>
        <Text>
          {brandBar(HEADING.length).map((segment, i) => (
            <Text key={i} color={segment.color}>
              {segment.text}
            </Text>
          ))}
        </Text>
        <Text color={PALETTE.muted}>{SUBTITLE}</Text>
        <Text color={PALETTE.muted}>v{VERSION}</Text>
      </Box>

      {/* Centered as a block; labels stay left-aligned with each other. */}
      <Box marginTop={1} justifyContent="center">
        <Box flexDirection="column">
          {START_ITEMS.map((item, i) => {
            const focused = i === focusIdx;
            return (
              <Text key={item.label} bold={focused} color={focused ? PALETTE.accent : undefined}>
                {focused ? `${FOCUS_MARKER} ` : '  '}
                {item.label}
              </Text>
            );
          })}
        </Box>
      </Box>

      <Box marginTop={1} justifyContent="center">
        <Text color={PALETTE.muted}>↑/↓ move · ⏎ select · q quit</Text>
      </Box>
    </Box>
  );
}
