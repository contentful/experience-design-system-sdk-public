import React from 'react';
import { Box, Text } from 'ink';

type StepHeaderProps = {
  stepNumber: number;
  totalSteps: number;
  title: string;
};

export function StepHeader({ stepNumber, totalSteps, title }: StepHeaderProps): React.ReactElement {
  return (
    <Box flexDirection="column" gap={0}>
      <Text dimColor>{'─'.repeat(40)}</Text>
      <Box gap={1}>
        <Text bold>
          Step {stepNumber} of {totalSteps}
        </Text>
        <Text bold>—</Text>
        <Text bold>{title}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(40)}</Text>
    </Box>
  );
}
