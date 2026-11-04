import React from 'react';
import { Box, Text } from 'ink';
import { ProgressBar, Spinner, ThemeProvider } from '@inkjs/ui';
import { PALETTE } from '@tui/theme.js';
import { activitySegment, formatElapsed, progressPercent, type RunningLine } from './logic.js';
import { PROGRESS_THEME } from './theme.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';
import type { ImportStepId } from '@tui/shared/components/StepHeader.js';
import { useElapsed, useElapsedSeconds } from './use-elapsed.js';

interface RunningStepProps {
  step: ImportStepId;
  description: string;
  elapsedLabel?: string;
  lines?: readonly RunningLine[];
}

function Line({ line }: { line: RunningLine }): React.ReactElement {
  const active = !line.complete && !line.pending && !line.failed;
  const seconds = useElapsedSeconds(active);
  const position = activitySegment(seconds);
  const counted = line.progress && line.progress.total > 0 ? line.progress : undefined;
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {line.failed ? (
          <Text color={PALETTE.error}>✗</Text>
        ) : line.complete ? (
          <Text color={PALETTE.success}>✓</Text>
        ) : line.pending ? (
          <Text color={PALETTE.muted}>◯</Text>
        ) : (
          <Spinner />
        )}
        <Text color={PALETTE.muted}>{line.text}</Text>
        {!line.pending && <Text color={PALETTE.muted}> · {formatElapsed(seconds)}</Text>}
      </Box>
      {line.detail && (
        <Box paddingLeft={2}>
          <Text color={PALETTE.muted}>{line.detail}</Text>
        </Box>
      )}
      {counted ? (
        <Box paddingLeft={2} gap={2}>
          <Box width={24}>
            <ThemeProvider theme={PROGRESS_THEME}>
              <ProgressBar value={progressPercent(counted)} />
            </ThemeProvider>
          </Box>
          <Text color={PALETTE.muted}>
            {counted.done}/{counted.total}
            {counted.label ? ` ${counted.label}` : ''}
          </Text>
        </Box>
      ) : active ? (
        <Box paddingLeft={2} gap={2}>
          <Text color={PALETTE.muted}>
            {'░'.repeat(position)}
            <Text color={PALETTE.accent}>{'━'.repeat(4)}</Text>
            {'░'.repeat(20 - position)}
          </Text>
          <Text color={PALETTE.muted}>Working…</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function RunningStep({
  step,
  description,
  elapsedLabel = 'Elapsed',
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
            <Line key={line.id ?? index} line={line} />
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color={PALETTE.muted}>
            {elapsedLabel}: {elapsed}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
