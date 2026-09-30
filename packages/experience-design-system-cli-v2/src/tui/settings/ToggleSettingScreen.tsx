import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../home/home.theme.js';

interface ToggleSetting {
  enabled: boolean;
}

export interface ToggleSettingScreenProps {
  /** Heading, for example "Settings › Debug Mode". */
  title: string;
  /** What the on/off value describes, shown before it: "Debug logging". */
  label: string;
  /** Optional explanation shown under the value while the setting is loaded. */
  description?: readonly string[];
  read: () => Promise<ToggleSetting>;
  write: (setting: ToggleSetting) => Promise<void>;
  onDone: () => void;
}

/**
 * A settings page with a single on/off value: loads it, toggles and saves on Enter or Space, and goes back on
 * Esc or q. Screens for individual preferences only supply their text and their store's read/write.
 */
export function ToggleSettingScreen({
  title,
  label,
  description = [],
  read,
  write,
  onDone,
}: ToggleSettingScreenProps): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    read().then((setting) => {
      setEnabled(setting.enabled);
      setLoading(false);
    });
  }, [read]);

  useInput((input, key) => {
    if (loading) return;

    if (key.return || input === ' ') {
      setEnabled((current) => {
        const next = !current;
        void write({ enabled: next });
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
      <Text bold>{title}</Text>
      <Text> </Text>
      {loading ? (
        <Text color={PALETTE.muted}>Loading…</Text>
      ) : (
        <>
          <Text>
            {label}:{' '}
            <Text bold color={enabled ? PALETTE.success : PALETTE.muted}>
              {enabled ? 'On' : 'Off'}
            </Text>
          </Text>
          {description.length > 0 && <Text> </Text>}
          {description.map((line) => (
            <Text key={line} dimColor>
              {line}
            </Text>
          ))}
        </>
      )}
      <Text> </Text>
      <Text dimColor>[Enter/Space] Toggle [Esc/q] Back to Settings</Text>
    </Box>
  );
}
