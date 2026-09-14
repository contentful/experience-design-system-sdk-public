import React from 'react';
import { Box, Text, useInput } from 'ink';

export function OptInAnalyticsScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  useInput((input, key) => {
    if (key.return || key.escape || input === 'q') {
      onDone();
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings › Opt-in Analytics</Text>
      <Text> </Text>
      <Text>This is a placeholder screen. No analytics preference is read or written yet.</Text>
      <Text> </Text>
      <Text dimColor>[Enter] Complete [Esc/q] Exit — both return to Settings</Text>
    </Box>
  );
}
