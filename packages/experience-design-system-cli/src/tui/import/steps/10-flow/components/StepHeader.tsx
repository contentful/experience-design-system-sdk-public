import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../../theme.js';

type StepHeaderProps = {
  stepNumber: number;
  totalSteps: number;
  title: string;
};

export function StepHeader({ stepNumber, totalSteps, title }: StepHeaderProps): React.ReactElement {
  return (
    <Box flexDirection="column" gap={0}>
      <Text color={PALETTE.muted}>{'─'.repeat(40)}</Text>
      <Box gap={1}>
        <Text bold>
          Step {stepNumber} of {totalSteps}
        </Text>
        <Text bold>—</Text>
        <Text bold>{title}</Text>
      </Box>
      <Text color={PALETTE.muted}>{'─'.repeat(40)}</Text>
    </Box>
  );
}
