import React from 'react';
import { Box, Text } from 'ink';

type FinalizeDialogProps = {
  accepted: number;
  rejected: number;
  needsReview: number;
  onConfirm: () => void;
  onCancel: () => void;
};

// Pure render — input handled by inputToAction in App.
export function FinalizeDialog({
  accepted,
  rejected,
  needsReview,
  onConfirm: _onConfirm,
  onCancel: _onCancel,
}: FinalizeDialogProps): React.ReactElement {
  const allResolved = needsReview === 0;

  return (
    <Box flexDirection="column" borderStyle="round" padding={1} width={58}>
      <Text bold>{'─'.repeat(17) + ' Finalize ' + '─'.repeat(17)}</Text>
      <Text> </Text>
      <Text>
        <Text color="green">{accepted} accepted</Text>
        <Text> · </Text>
        <Text color="red">{rejected} rejected</Text>
        <Text> · </Text>
        <Text dimColor>{needsReview} unresolved</Text>
      </Text>
      <Text> </Text>
      {!allResolved && (
        <>
          <Text color="yellow">
            {'⚠ ' + needsReview + ' component' + (needsReview === 1 ? ' is' : 's are') + ' unresolved and will be'}
          </Text>
          <Text color="yellow">{'  excluded from the output.'}</Text>
          <Text> </Text>
        </>
      )}
      <Text>{allResolved ? 'Save decisions and exit? All components resolved.' : 'Save decisions and exit?'}</Text>
      <Text> </Text>
      <Text>{'  [y / Enter]  Confirm    [n / Esc]  Cancel'}</Text>
    </Box>
  );
}
