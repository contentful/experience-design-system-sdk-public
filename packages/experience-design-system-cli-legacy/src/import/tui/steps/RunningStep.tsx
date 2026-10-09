import React from 'react';
import { PALETTE, INK_UI_THEME } from '../../../analyze/select/tui/theme.js';
import { Box, Text } from 'ink';
import { ProgressBar, ThemeProvider } from '@inkjs/ui';
import { StepHeader } from '../components/StepHeader.js';
import { useTimedSpinner } from '../../../tui/use-timed-spinner.js';

type Progress = { done: number; total: number };

type RunningStepProps = {
  stepNumber: number;
  totalSteps: number;
  title: string;
  description: string;
  detail?: string;
  detailComplete?: boolean;
  /** Progress for the detail row (displays as progress bar + ratio). */
  detailProgress?: Progress;
  /** Optional second progress line (own spinner) — e.g. composition resolution
   *  running after the file scan on the extracting screen. */
  secondaryDetail?: string;
  secondaryComplete?: boolean;
  /** Progress for the secondary detail row (displays as progress bar + ratio). */
  secondaryProgress?: Progress;
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
  detailProgress,
  secondaryDetail,
  secondaryComplete = false,
  secondaryProgress,
  tertiaryDetail,
  tertiaryComplete = false,
  quaternaryDetail,
  quaternaryComplete = false,
  quinaryDetail,
  quinaryComplete = false,
}: RunningStepProps): React.ReactElement {
  const { spinner, elapsed } = useTimedSpinner();

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <StepHeader stepNumber={stepNumber} totalSteps={totalSteps} title={title} />

      <Text>{description}</Text>

      <Box gap={1} marginTop={1} flexDirection="column">
        {detailProgress ? (
          <>
            <Box gap={2}>
              <Box width={40}>
                <ThemeProvider theme={INK_UI_THEME}>
                  <ProgressBar value={Math.round((detailProgress.done / detailProgress.total) * 100)} />
                </ThemeProvider>
              </Box>
              <Text color={PALETTE.muted}>
                {detailProgress.done}/{detailProgress.total}
              </Text>
            </Box>
            <Text color={PALETTE.muted}>{detail ?? 'Running...'}</Text>
          </>
        ) : (
          <Box gap={1}>
            {detailComplete ? <Text color={PALETTE.success}>✓</Text> : spinner}
            <Text color={PALETTE.muted}>{detail ?? 'Running...'}</Text>
          </Box>
        )}
      </Box>
      {secondaryDetail !== undefined && (
        <Box gap={1} flexDirection="column">
          {secondaryProgress ? (
            <>
              <Box gap={2}>
                <Box width={40}>
                  <ThemeProvider theme={INK_UI_THEME}>
                    <ProgressBar value={Math.round((secondaryProgress.done / secondaryProgress.total) * 100)} />
                  </ThemeProvider>
                </Box>
                <Text color={PALETTE.muted}>
                  {secondaryProgress.done}/{secondaryProgress.total}
                </Text>
              </Box>
              <Text color={PALETTE.muted}>{secondaryDetail}</Text>
            </>
          ) : (
            <Box gap={1}>
              {secondaryComplete ? <Text color={PALETTE.success}>✓</Text> : spinner}
              <Text color={PALETTE.muted}>{secondaryDetail}</Text>
            </Box>
          )}
        </Box>
      )}
      {tertiaryDetail !== undefined && (
        <Box gap={1}>
          {tertiaryComplete ? <Text color={PALETTE.success}>✓</Text> : spinner}
          <Text color={PALETTE.muted}>{tertiaryDetail}</Text>
        </Box>
      )}
      {quaternaryDetail !== undefined && (
        <Box gap={1}>
          {quaternaryComplete ? <Text color={PALETTE.success}>✓</Text> : spinner}
          <Text color={PALETTE.muted}>{quaternaryDetail}</Text>
        </Box>
      )}
      {quinaryDetail !== undefined && (
        <Box gap={1}>
          {quinaryComplete ? <Text color={PALETTE.success}>✓</Text> : spinner}
          <Text color={PALETTE.muted}>{quinaryDetail}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={PALETTE.muted}>Elapsed: {elapsed}</Text>
      </Box>
    </Box>
  );
}
