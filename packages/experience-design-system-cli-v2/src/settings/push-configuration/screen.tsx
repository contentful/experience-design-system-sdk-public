import React from 'react';
import { Box, Text, useInput } from 'ink';

export function ConfigurationScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  useInput((input, key) => {
    if (key.return || key.escape || input === 'q') {
      onDone();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings › Configuration</Text>
      <Text> </Text>
      <Text>This is a placeholder screen. No push configuration is read or written yet.</Text>
      <Text> </Text>
      <Text dimColor>[Enter] Complete [Esc/q] Exit — both return to Settings</Text>
    </Box>
  );
}
