import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { startDebugRun, finishDebugRun } from '../debug-store.js';

export function HelpScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  useEffect(() => {
    startDebugRun({ flow: 'help', step: '01-help', menuOption: 'Help', inputs: {} });
  }, []);

  const leave = (exitMethod: 'saved' | 'discarded'): void => {
    void finishDebugRun({ outputs: {}, status: 'success', exitMethod });
    onDone();
  };

  useInput((input, key) => {
    if (key.return) {
      leave('saved');
      return;
    }
    if (key.escape || input === 'q') {
      leave('discarded');
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Help</Text>
      <Text> </Text>
      <Text>This is a placeholder screen for v2 help content.</Text>
      <Text> </Text>
      <Text dimColor>[Enter] Complete [Esc/q] Exit — both return to Start</Text>
    </Box>
  );
}
