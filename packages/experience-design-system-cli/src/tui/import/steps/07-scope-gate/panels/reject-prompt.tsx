import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../sidebar/theme.js';
import type { PendingRejectCascade } from '../use-scope-gate.js';

export function RejectPrompt({ pending }: { pending: PendingRejectCascade }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={PALETTE.warning} paddingX={1} marginTop={1}>
      <Text bold color={PALETTE.warning}>
        {`Rejecting ${pending.target} will:`}
      </Text>
      {pending.ancestors.length > 0 && <Text>{`- Reject ancestors: ${pending.ancestors.join(', ')}`}</Text>}
      {pending.descendants.length > 0 && <Text>{`- Deselect descendants: ${pending.descendants.join(', ')}`}</Text>}
      <Text>[y] confirm · [n]/[Esc] cancel</Text>
    </Box>
  );
}
