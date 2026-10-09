import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../theme.js';

export type RationaleLineData =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; dim?: boolean }
  | { kind: 'label'; text: string; prefix?: string; suffix?: string; color?: string }
  | { kind: 'blank' };

export function RationaleLine({ line, active }: { line: RationaleLineData; active: boolean }): React.ReactElement {
  if (line.kind === 'blank') {
    return (
      <Box>
        <Text> </Text>
      </Box>
    );
  }

  if (line.kind === 'heading') {
    return (
      <Box>
        <Text bold color={active ? PALETTE.info : PALETTE.muted}>
          {line.text}
        </Text>
      </Box>
    );
  }

  if (line.kind === 'label') {
    return (
      <Box>
        {line.prefix && <Text>{line.prefix}</Text>}
        <Text bold color={active ? line.color : PALETTE.muted}>
          {line.text}
        </Text>
        {line.suffix && <Text color={PALETTE.muted}>{line.suffix}</Text>}
      </Box>
    );
  }

  return (
    <Box>
      <Text color={!active || line.dim ? PALETTE.muted : undefined}>{line.text}</Text>
    </Box>
  );
}
