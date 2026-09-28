import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../analyze/select/tui/theme.js';

const SETUP_SCREENS = ['Prerequisites', 'Coding agent', 'Contentful', 'Preferences'] as const;

const WIDE_SEPARATOR = '  ·  ';
const COMPACT_GAP = 2;

/** The width the labelled stepper needs; narrower terminals get numbers only. */
const WIDE_MIN_COLUMNS = SETUP_SCREENS.map((title, index) =>
  index === 0 ? `[${index + 1} ${title}]` : `${index + 1} ${title}`,
).join(WIDE_SEPARATOR).length;

type StepState = 'complete' | 'active' | 'pending';

function stepLabel(step: number, title: string, state: StepState, wide: boolean): string {
  if (state === 'complete') return wide ? `✓ ${title}` : '✓';
  if (state === 'active') return wide ? `[${step} ${title}]` : `[${step}]`;
  return wide ? `${step} ${title}` : `${step}`;
}

function stepColor(state: StepState): string | undefined {
  if (state === 'complete') return PALETTE.success;
  if (state === 'active') return PALETTE.info;
  return undefined;
}

type SetupStepperProps = {
  activeStep: number;
  columns?: number;
};

export function SetupStepper({ activeStep, columns }: SetupStepperProps): React.ReactElement {
  const wide = columns !== undefined && columns >= WIDE_MIN_COLUMNS;

  return (
    <Box columnGap={wide ? 0 : COMPACT_GAP}>
      {SETUP_SCREENS.map((title, index) => {
        const step = index + 1;
        const state: StepState = step < activeStep ? 'complete' : step === activeStep ? 'active' : 'pending';
        return (
          <React.Fragment key={step}>
            {wide && index > 0 && <Text dimColor>{WIDE_SEPARATOR}</Text>}
            <Text bold={state === 'active'} dimColor={state === 'pending'} color={stepColor(state)}>
              {stepLabel(step, title, state, wide)}
            </Text>
          </React.Fragment>
        );
      })}
    </Box>
  );
}
