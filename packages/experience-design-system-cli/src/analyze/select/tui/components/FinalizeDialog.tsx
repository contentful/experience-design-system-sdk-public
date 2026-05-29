import React from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../hooks/useImmediateInput.js';

type FinalizeDialogProps = {
  accepted: number;
  rejected: number;
  needsReview: number;
  onConfirm: () => void;
  onCancel: () => void;
};

export function FinalizeDialog({
  accepted,
  rejected,
  needsReview,
  onConfirm,
  onCancel,
}: FinalizeDialogProps): React.ReactElement {
  useImmediateInput((input, key) => {
    if (input === 'y' || key.return) {
      onConfirm();
    } else if (input === 'n' || key.escape) {
      onCancel();
    }
  });

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
