import React, { useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { PALETTE } from '../home/home.theme.js';

export function ImportScreen({ exitCode, onDone }: { exitCode?: number; onDone: () => void }): React.ReactElement {
  const { stdout } = useStdout();
  useEffect(() => {
    stdout.write('\x1b[H\x1b[0J');
  }, [stdout]);

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
      <Text>[Enter] Back to Start</Text>
    </Box>
  );
}
