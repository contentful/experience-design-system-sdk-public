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
        <Text bold color={PALETTE.info} dimColor={!active}>
          {line.text}
        </Text>
      </Box>
    );
  }

  if (line.kind === 'label') {
    return (
      <Box>
        {line.prefix && <Text>{line.prefix}</Text>}
        <Text bold color={line.color} dimColor={!active}>
          {line.text}
        </Text>
        {line.suffix && <Text dimColor>{line.suffix}</Text>}
      </Box>
    );
  }

  return (
    <Box>
      <Text dimColor={!active || line.dim}>{line.text}</Text>
    </Box>
  );
}
