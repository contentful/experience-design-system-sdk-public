import React from 'react';
import { Box, Text } from 'ink';
import { ProgressBar, ThemeProvider } from '@inkjs/ui';
import type { PushProgress } from '../push-progress.js';
import { StepHeader } from '../components/StepHeader.js';
import { useTimedSpinner } from '../../../tui/use-timed-spinner.js';
import { INK_UI_THEME } from '../../../analyze/select/tui/theme.js';
import { PALETTE } from '../../../analyze/select/tui/theme.js';

type PushingStepProps = {
  stepNumber: number;
  totalSteps: number;
  progress: PushProgress;
};

export function PushingStep({ stepNumber, totalSteps, progress }: PushingStepProps): React.ReactElement {
  const { elapsed } = useTimedSpinner();

  const operationId = progress && progress.kind === 'queued' ? progress.operationId : null;

  const showGlobal = progress && progress.kind === 'progress';
  const showCurrent = progress && progress.kind === 'progress' && progress.current ? progress.current : null;

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <StepHeader stepNumber={stepNumber} totalSteps={totalSteps} title="Push to Contentful" />

      <Text>Writing component types and design tokens to your Contentful space...</Text>

      {operationId && (
        <Box gap={1}>
          <Text color={PALETTE.muted}>Operation:</Text>
          <Text>{operationId}</Text>
        </Box>
      )}

      {showGlobal && progress && progress.kind === 'progress' && (
        <Box gap={1} flexDirection="column">
          <Box gap={2}>
            <Box width={40}>
              <ThemeProvider theme={INK_UI_THEME}>
                <ProgressBar value={Math.round((progress.processed / progress.total) * 100)} />
              </ThemeProvider>
            </Box>
            <Text color={PALETTE.muted}>
              {progress.processed}/{progress.total} entities
            </Text>
          </Box>
        </Box>
      )}

      {showCurrent && (
        <Box gap={1}>
          <Text color={PALETTE.muted}>Now processing:</Text>
          <Text>{showCurrent}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={PALETTE.muted}>Elapsed: {elapsed}</Text>
      </Box>
    </Box>
  );
}
