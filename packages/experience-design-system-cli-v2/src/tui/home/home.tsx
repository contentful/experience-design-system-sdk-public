import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Screen } from '../../../app.js';
import { FOCUS_MARKER, PALETTE, brandBar } from './home.theme.js';
import { readPackageVersion } from '../version.js';
import { useTerminalWidth } from '../use-terminal-width.js';
import { checkForUpgrade, type UpgradeCheckResult } from '../../api/version-check.js';

const VERSION = readPackageVersion();
const HEADING = 'Contentful Experiences';
const SUBTITLE = "Let's import your design system into Contentful";

export const MIN_TERMINAL_WIDTH = 164;

const START_ITEMS: { label: string; screen: Screen }[] = [
  { label: 'Import', screen: 'import' },
  { label: 'Saved Runs', screen: 'saved-runs' },
  { label: 'Upgrade Version', screen: 'upgrade' },
  { label: 'Settings', screen: 'settings' },
  { label: 'Help', screen: 'help' },
];

export function HomeScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }): React.ReactElement {
  const [focusIdx, setFocusIdx] = useState(0);
  const [upgradeCheck, setUpgradeCheck] = useState<UpgradeCheckResult | null>(null);
  const { exit } = useApp();
  const terminalWidth = useTerminalWidth();
  const tooNarrow = terminalWidth < MIN_TERMINAL_WIDTH;

  useEffect(() => {
    let cancelled = false;
    void checkForUpgrade().then((result) => {
      if (!cancelled) {
        setUpgradeCheck(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isUpgradeDisabled = upgradeCheck?.status === 'up-to-date';

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
      const chosen = START_ITEMS[focusIdx]!;
      if (chosen.screen === 'upgrade' && isUpgradeDisabled) {
        return;
      }
      onNavigate(chosen.screen);
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

      <Box marginTop={1} justifyContent="center">
        <Box flexDirection="column">
          {START_ITEMS.map((item, i) => {
            const focused = i === focusIdx;
            const disabled = item.screen === 'upgrade' && isUpgradeDisabled;

            let label = item.label;
            if (item.screen === 'upgrade' && upgradeCheck?.status === 'update-available') {
              label = `Upgrade (v${upgradeCheck.latest} available)`;
            } else if (item.screen === 'upgrade' && upgradeCheck?.status === 'up-to-date') {
              label = 'Upgrade (up to date)';
            }

            return (
              <Text
                key={item.label}
                bold={focused}
                color={disabled ? PALETTE.muted : focused ? PALETTE.accent : undefined}
              >
                {focused ? `${FOCUS_MARKER} ` : '  '}
                {label}
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
