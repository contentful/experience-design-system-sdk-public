import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Screen } from '../../../app.js';
import { PALETTE } from '../theme.js';
import { FOCUS_MARKER, brandBar } from './home.theme.js';
import { checkForUpgrade, readPackageVersion, type UpgradeCheckResult } from '../upgrade/version.js';
import { useTerminalWidth } from '../use-terminal-width.js';
import { ControlHints } from '../control-hints.js';

const VERSION = readPackageVersion();
const HEADING = 'Contentful Experiences';
const SUBTITLE = "Let's import your design system into Contentful";

const MIN_TERMINAL_WIDTH = 164;

const START_ITEMS: { label: string; screen: Screen }[] = [
  { label: 'Import', screen: 'import' },
  { label: 'Settings', screen: 'settings' },
  { label: 'Help', screen: 'help' },
];

function versionStatus(upgradeCheck: UpgradeCheckResult | undefined): { text: string; color: string } | undefined {
  if (upgradeCheck?.status === 'update-available') {
    return { text: ` (upgrade available v${upgradeCheck.latest})`, color: PALETTE.warning };
  }
  if (upgradeCheck?.status === 'up-to-date') {
    return { text: ' (up to date)', color: PALETTE.muted };
  }
  return undefined;
}

export function HomeScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }): React.ReactElement {
  const [focusIdx, setFocusIdx] = useState(0);
  const [upgradeCheck, setUpgradeCheck] = useState<UpgradeCheckResult>();
  const { exit } = useApp();
  const terminalWidth = useTerminalWidth();
  const tooNarrow = terminalWidth < MIN_TERMINAL_WIDTH;
  const status = versionStatus(upgradeCheck);

  useEffect(() => {
    checkForUpgrade()
      .then(setUpgradeCheck)
      .catch(() => setUpgradeCheck({ status: 'error' }));
  }, []);

  useInput((input, key) => {
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
      const item = START_ITEMS[focusIdx]!;
      onNavigate(item.screen);
      return;
    }
  });

  if (tooNarrow) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color={PALETTE.warning}>
          Terminal too small
        </Text>
        <Text color={PALETTE.muted}>
          Press q to quit, make your terminal full screen, then run experiences import again.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="column" alignItems="center">
        <Text bold>{HEADING}</Text>
        <Text>
          {brandBar(HEADING.length).map((segment, i) => (
            <Text key={i} color={segment.color}>
              {segment.text}
            </Text>
          ))}
        </Text>
        <Text color={PALETTE.muted}>{SUBTITLE}</Text>
        <Text color={PALETTE.muted}>
          v{VERSION}
          {status && <Text color={status.color}>{status.text}</Text>}
        </Text>
      </Box>

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
        <ControlHints
          hints={[
            { keys: '↑/↓', label: 'move' },
            { keys: '⏎', label: 'select' },
            { keys: 'q', label: 'quit' },
          ]}
        />
      </Box>
    </Box>
  );
}
