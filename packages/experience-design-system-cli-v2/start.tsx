import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Screen } from './app.js';
import { FOCUS_MARKER, PALETTE, brandBar } from './src/tui/theme.js';
import { readPackageVersion } from './src/tui/version.js';
import { useTerminalWidth } from './src/tui/use-terminal-width.js';

const VERSION = readPackageVersion();
const HEADING = 'Contentful Experiences';
const SUBTITLE = "Let's import your design system into Contentful";

/** Width the layout strictly needs: the longest line plus its side padding. */
const LAYOUT_COLUMNS = 41;

/**
 * Narrowest terminal the home page renders in.
 *
 * Four times what the layout strictly needs, so the page only appears in a
 * generously sized window; below it the menu is gated behind a notice. Note
 * this is well above a default 80-column terminal, so most windows must be
 * widened (or maximized) before the menu shows.
 */
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
    // Quitting stays available while the too-narrow notice is showing; menu
    // navigation does not, since the menu is not on screen.
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
        {/* Two short lines rather than one long one: the notice appears on
            terminals too narrow to fit the full sentence unwrapped. */}
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
        {/* Brand bar underlining the heading: one segment per brand color. It
            can match the heading exactly, since MIN_COLUMNS guarantees room. */}
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

      {/* The column is centered as a block while labels stay left-aligned with
          each other, so the focus marker reads down a single edge. */}
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
