import React from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../hooks/useImmediateInput.js';

type QuitDialogProps = {
  hasUnsavedDrafts: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function QuitDialog({ hasUnsavedDrafts, onConfirm, onCancel }: QuitDialogProps): React.ReactElement {
  useImmediateInput((input, key) => {
    if (input === 'y' || key.return) {
      onConfirm();
    } else if (input === 'n' || key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" padding={1} width={50}>
      <Text bold>{'─'.repeat(19) + ' Quit ' + '─'.repeat(19)}</Text>
      <Text> </Text>
      {hasUnsavedDrafts ? (
        <>
          <Text>You have unsaved draft edits.</Text>
          <Text>{'Session state is preserved — you can resume'}</Text>
          <Text>{'by running the same review command again.'}</Text>
        </>
      ) : (
        <Text>Session is saved. Quit without finalizing?</Text>
      )}
      <Text> </Text>
      <Text>{'  [y / Enter]  Quit    [n / Esc]  Stay'}</Text>
    </Box>
  );
}
