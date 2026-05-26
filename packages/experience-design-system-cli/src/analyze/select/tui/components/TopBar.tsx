import React from 'react';
import { Box, Text } from 'ink';

type TopBarProps = {
  subcommand: string;
  hints: Array<{ key: string; label: string }>;
};

export function TopBar({ subcommand, hints }: TopBarProps): React.ReactElement {
  return (
    <Box justifyContent="space-between">
      <Text bold>{'experience-design-system-cli  ' + subcommand}</Text>
      <Text dimColor>{hints.map((h) => `[${h.key}] ${h.label}`).join('  ')}</Text>
    </Box>
  );
}
