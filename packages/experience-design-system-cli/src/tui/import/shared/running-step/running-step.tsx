import React from 'react';
import { Box, Text } from 'ink';
import { ProgressBar, Spinner, ThemeProvider } from '@inkjs/ui';
import { PALETTE } from '@tui/theme.js';
import { progressPercent, type RunningLine } from './logic.js';
import { PROGRESS_THEME } from './theme.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';
import type { ImportStepId } from '@tui/shared/components/StepHeader.js';
import { useElapsed } from './use-elapsed.js';

interface RunningStepProps {
  step: ImportStepId;
  description: string;
  lines?: readonly RunningLine[];
}

function Line({ line }: { line: RunningLine }): React.ReactElement {
  if (line.progress) {
    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={2}>
          <Box width={40}>
            <ThemeProvider theme={PROGRESS_THEME}>
              <ProgressBar value={progressPercent(line.progress)} />
            </ThemeProvider>
          </Box>
          <Text color={PALETTE.muted}>
            {line.progress.done}/{line.progress.total}
          </Text>
        </Box>
        <Text color={PALETTE.muted}>{line.text}</Text>
      </Box>
    );
  }
  return (
    <Box gap={1}>
      {line.complete ? <Text color={PALETTE.success}>✓</Text> : <Spinner />}
      <Text color={PALETTE.muted}>{line.text}</Text>
    </Box>
  );
}

export function RunningStep({
  step,
  description,
  lines = [{ text: 'Running...' }],
}: RunningStepProps): React.ReactElement {
  const elapsed = useElapsed();

  return (
    <Box flexDirection="column">
      <StepHeader step={step} />
      <Box flexDirection="column" gap={1} paddingX={2} paddingBottom={1}>
        <Text>{description}</Text>
        <Box marginTop={1} flexDirection="column" gap={1}>
          {lines.map((line, index) => (
            <Line key={index} line={line} />
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color={PALETTE.muted}>Elapsed: {elapsed}</Text>
        </Box>
      </Box>
    </Box>
  );
}
