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

/**
 * The persistent progress row shown above every setup screen. Labels appear
 * once the terminal is wide enough; narrower terminals get numbered markers so
 * the row never wraps.
 */
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
