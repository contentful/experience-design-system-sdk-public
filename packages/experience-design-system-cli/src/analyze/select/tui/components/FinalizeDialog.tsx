import React from 'react';
import { PALETTE } from '../theme.js';
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
        <Text color={PALETTE.success}>{accepted} accepted</Text>
        <Text> · </Text>
        <Text color={PALETTE.error}>{rejected} rejected</Text>
        <Text> · </Text>
        <Text dimColor>{needsReview} unresolved</Text>
      </Text>
      <Text> </Text>
      {!allResolved && (
        <>
          <Text color={PALETTE.warning}>
            {'⚠ ' + needsReview + ' unresolved component' + (needsReview === 1 ? '' : 's') + ' will not be pushed.'}
          </Text>
          <Text color={PALETTE.warning}>{'  Only explicitly accepted components ship.'}</Text>
          <Text> </Text>
        </>
      )}
      <Text>{allResolved ? 'Save decisions and exit? All components resolved.' : 'Save decisions and exit?'}</Text>
      <Text> </Text>
      <Text>{'  [y / Enter]  Confirm    [n / Esc]  Cancel'}</Text>
    </Box>
  );
}
