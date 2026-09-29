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
  detailComplete?: boolean;
  /** Optional second progress line (own spinner) — e.g. composition resolution
   *  running after the file scan on the extracting screen. */
  secondaryDetail?: string;
  secondaryComplete?: boolean;
  /** Optional third progress line for another concurrent stage. */
  tertiaryDetail?: string;
  tertiaryComplete?: boolean;
  /** Optional fourth progress line for another concurrent stage. */
  quaternaryDetail?: string;
  quaternaryComplete?: boolean;
  /** Optional fifth progress line for another concurrent stage. */
  quinaryDetail?: string;
  quinaryComplete?: boolean;
};

export function RunningStep({
  stepNumber,
  totalSteps,
  title,
  description,
  detail,
  detailComplete = false,
  secondaryDetail,
  secondaryComplete = false,
  tertiaryDetail,
  tertiaryComplete = false,
  quaternaryDetail,
  quaternaryComplete = false,
  quinaryDetail,
  quinaryComplete = false,
}: RunningStepProps): React.ReactElement {
  const { spinner, secondarySpinner, elapsed } = useTimedSpinner();

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <StepHeader stepNumber={stepNumber} totalSteps={totalSteps} title={title} />

      <Text>{description}</Text>

      <Box gap={1} marginTop={1}>
        <Text color={detailComplete ? PALETTE.success : PALETTE.info}>{detailComplete ? '✓' : spinner}</Text>
        <Text dimColor>{detail ?? 'Running...'}</Text>
      </Box>
      {secondaryDetail !== undefined && (
        <Box gap={1}>
          <Text color={secondaryComplete ? PALETTE.success : PALETTE.info}>
            {secondaryComplete ? '✓' : secondarySpinner}
          </Text>
          <Text dimColor>{secondaryDetail}</Text>
        </Box>
      )}
      {tertiaryDetail !== undefined && (
        <Box gap={1}>
          <Text color={tertiaryComplete ? PALETTE.success : PALETTE.info}>
            {tertiaryComplete ? '✓' : secondarySpinner}
          </Text>
          <Text dimColor>{tertiaryDetail}</Text>
        </Box>
      )}
      {quaternaryDetail !== undefined && (
        <Box gap={1}>
          <Text color={quaternaryComplete ? PALETTE.success : PALETTE.info}>
            {quaternaryComplete ? '✓' : secondarySpinner}
          </Text>
          <Text dimColor>{quaternaryDetail}</Text>
        </Box>
      )}
      {quinaryDetail !== undefined && (
        <Box gap={1}>
          <Text color={quinaryComplete ? PALETTE.success : PALETTE.info}>
            {quinaryComplete ? '✓' : secondarySpinner}
          </Text>
          <Text dimColor>{quinaryDetail}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Elapsed: {elapsed}</Text>
      </Box>
    </Box>
  );
}
