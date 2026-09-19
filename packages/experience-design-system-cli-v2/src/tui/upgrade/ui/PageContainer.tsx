import React from 'react';
import { Box, Text } from 'ink';
import { UpgradeExecutionScreen } from './UpgradeScreen.js';

export function UpgradeScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Upgrade</Text>
      <Text> </Text>
      <UpgradeExecutionScreen onDone={onDone} />
    </Box>
  );
}
