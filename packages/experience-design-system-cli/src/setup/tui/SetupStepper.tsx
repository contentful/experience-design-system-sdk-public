import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../analyze/select/tui/theme.js';
import { setupStepperEntries, setupStepperSeparator, type SetupStepState } from '../screen.js';

type SetupStepperProps = {
  activeStep: number;
  columns?: number;
};

function stepColor(state: SetupStepState): string | undefined {
  if (state === 'complete') return PALETTE.success;
  if (state === 'active') return PALETTE.info;
  return undefined;
}

export function SetupStepper({ activeStep, columns }: SetupStepperProps): React.ReactElement {
  const entries = setupStepperEntries(activeStep, columns);
  const separator = setupStepperSeparator(columns);

  return (
    <Box>
      {entries.map((entry, index) => (
        <React.Fragment key={entry.step}>
          {index > 0 && <Text dimColor>{separator}</Text>}
          <Text bold={entry.state === 'active'} dimColor={entry.state === 'pending'} color={stepColor(entry.state)}>
            {entry.label}
          </Text>
        </React.Fragment>
      ))}
    </Box>
  );
}
