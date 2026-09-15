import React from 'react';
import { Box, Text, useInput } from 'ink';

export function SavedRunsScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  useInput((input, key) => {
    if (key.return) {
      onDone();
      return;
    }
    if (key.escape || input === 'q') {
      onDone();
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Saved Runs</Text>
      <Text> </Text>
      <Text>This is a placeholder screen for viewing saved import runs.</Text>
      <Text> </Text>
      <Text dimColor>[Enter] Complete [Esc/q] Exit — both return to Start</Text>
    </Box>
  );
}
