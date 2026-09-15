import React from 'react';
import { Box, Text, useInput } from 'ink';

export function UpgradeScreen({ onDone }: { onDone: () => void }): React.ReactElement {
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
      <Text bold>Upgrade</Text>
      <Text> </Text>
      <Text>This is a placeholder screen for v2 upgrade content.</Text>
      <Text> </Text>
      <Text dimColor>
        Coming soon: checks your installed version against the latest release and upgrades the TUI and CLI in place.
      </Text>
      <Text> </Text>
      <Text dimColor>[Enter] Complete [Esc/q] Exit — both return to Start</Text>
    </Box>
  );
}
