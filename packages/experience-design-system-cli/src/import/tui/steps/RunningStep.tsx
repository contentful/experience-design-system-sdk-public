import React from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { Box, Text } from 'ink';
import { StepHeader } from '../components/StepHeader.js';
import { useTimedSpinner } from '../../../tui/use-timed-spinner.js';

type RunningStepProps = {
  stepNumber: number;
  totalSteps: number;
  title: string;
  description: string;
  detail?: string;
  /** Optional second progress line (own spinner) — e.g. composition resolution
   *  running after the file scan on the extracting screen. */
  secondaryDetail?: string;
};

export function RunningStep({
  stepNumber,
  totalSteps,
  title,
  description,
  detail,
  secondaryDetail,
}: RunningStepProps): React.ReactElement {
  const { spinner, secondarySpinner, elapsed } = useTimedSpinner();

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <StepHeader stepNumber={stepNumber} totalSteps={totalSteps} title={title} />

      <Text>{description}</Text>

      <Box gap={1} marginTop={1}>
        <Text color={PALETTE.info}>{spinner}</Text>
        <Text dimColor>{detail ?? 'Running...'}</Text>
      </Box>
      {secondaryDetail !== undefined && (
        <Box gap={1}>
          <Text color={PALETTE.info}>{secondarySpinner}</Text>
          <Text dimColor>{secondaryDetail}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Elapsed: {elapsed}</Text>
      </Box>
    </Box>
  );
}
