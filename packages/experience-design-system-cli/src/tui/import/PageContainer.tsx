import React from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../theme.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';

export function ImportScreen({ exitCode, onDone }: { exitCode?: number; onDone: () => void }): React.ReactElement {
  useInput((input, key) => {
    if (key.return || key.escape || input === 'q') {
      onDone();
    }
  });

  const isSuccess = exitCode === 0;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text> </Text>
      {isSuccess ? (
        <Text color={PALETTE.success}>✓ Import complete</Text>
      ) : (
        <Text color={PALETTE.error}>✗ Import failed: process exited with code {exitCode ?? 'unknown'}</Text>
      )}
      <Text> </Text>
      <ControlHints hints={[{ keys: 'Enter', label: 'Back to Start' }]} />
    </Box>
  );
}
