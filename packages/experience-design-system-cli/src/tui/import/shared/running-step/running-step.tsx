import React from 'react';
import { Box, Text } from 'ink';
import { ProgressBar, Spinner, ThemeProvider } from '@inkjs/ui';
import { PALETTE } from '@tui/theme.js';
import { formatDuration, lineState, progressPercent, type RunningLine } from './logic.js';
import { PROGRESS_THEME } from './theme.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';
import type { ImportStepId } from '@tui/shared/components/StepHeader.js';
import { useElapsed } from './use-elapsed.js';

interface RunningStepProps {
  step: ImportStepId;
  description: string;
  lines?: readonly RunningLine[];
}

// Every icon is one column wide, so the text lines up. The warning sign is two columns in many terminals.
const STATE_ICON = { done: '✓', warning: '!', failed: '✗' } as const;
const STATE_COLOR = { done: PALETTE.success, warning: PALETTE.warning, failed: PALETTE.error } as const;

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
  const state = lineState(line);
  return (
    <Box gap={1}>
      {state === 'running' ? <Spinner /> : <Text color={STATE_COLOR[state]}>{STATE_ICON[state]}</Text>}
      <Text color={state === 'warning' || state === 'failed' ? STATE_COLOR[state] : PALETTE.muted}>{line.text}</Text>
      {line.ms !== undefined && <Text color={PALETTE.muted}>{formatDuration(line.ms)}</Text>}
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
