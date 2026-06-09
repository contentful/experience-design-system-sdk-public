import React from 'react';
import { Box, Text } from 'ink';

type QuitDialogProps = {
  hasUnsavedDrafts: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// Pure render — input handled by inputToAction in App.
export function QuitDialog({
  hasUnsavedDrafts,
  onConfirm: _onConfirm,
  onCancel: _onCancel,
}: QuitDialogProps): React.ReactElement {
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
