import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from './theme.js';

export interface ControlHint {
  keys: string;
  label: string;
  active?: boolean;
}

export function ControlHints({ hints }: { hints: readonly ControlHint[] }): React.ReactElement {
  return (
    <Box flexWrap="wrap" columnGap={2}>
      {hints.map((hint) => (
        <Text key={hint.keys + hint.label}>
          <Text color={hint.active ? PALETTE.warning : PALETTE.accent} inverse={hint.active}>
            [{hint.keys}]
          </Text>
          <Text color={hint.active ? PALETTE.warning : undefined} inverse={hint.active}>
            {' ' + hint.label}
          </Text>
        </Text>
      ))}
    </Box>
  );
}
