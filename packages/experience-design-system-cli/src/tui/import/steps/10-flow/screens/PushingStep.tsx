import React from 'react';
import { Box, Text } from 'ink';
import { ProgressBar, ThemeProvider } from '@inkjs/ui';
import type { PushProgress } from '../support/push-progress.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';
import { writtenThings, type Produced } from '../support/produced.js';
import { useTimedSpinner } from '../support/use-timed-spinner.js';
import { PROGRESS_THEME } from '../../../shared/running-step/theme.js';
import { PALETTE } from '@tui/theme.js';

type PushingStepProps = {
  progress: PushProgress;
  produced: Produced;
};

export function PushingStep({ progress, produced }: PushingStepProps): React.ReactElement {
  const { elapsed } = useTimedSpinner();

  const operationId = progress && progress.kind === 'queued' ? progress.operationId : null;

  const showGlobal = progress && progress.kind === 'progress';
  const showCurrent = progress && progress.kind === 'progress' && progress.current ? progress.current : null;

  return (
    <Box flexDirection="column">
      <StepHeader step="push" />
      <Box flexDirection="column" gap={1} paddingX={2} paddingBottom={1}>
        <Text>Writing {writtenThings(produced)} to your Contentful space...</Text>

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
                <ThemeProvider theme={PROGRESS_THEME}>
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
    </Box>
  );
}
