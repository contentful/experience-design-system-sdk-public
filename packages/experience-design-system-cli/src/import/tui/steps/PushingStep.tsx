import React, { useEffect, useState } from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { Box, Text } from 'ink';
import type { PushProgress } from '../push-progress.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

type PushingStepProps = {
  stepNumber: number;
  totalSteps: number;
  progress: PushProgress;
};

export function PushingStep({ stepNumber, totalSteps, progress }: PushingStepProps): React.ReactElement {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const spinner = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(spinner);
      clearInterval(timer);
    };
  }, []);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const operationId = progress && progress.kind === 'queued' ? progress.operationId : null;

  const showGlobal = progress && progress.kind === 'progress';
  const showCurrent = progress && progress.kind === 'progress' && progress.current ? progress.current : null;

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Box flexDirection="column" gap={0}>
        <Text dimColor>{'─'.repeat(40)}</Text>
        <Box gap={1}>
          <Text bold>
            Step {stepNumber} of {totalSteps}
          </Text>
          <Text bold>—</Text>
          <Text bold>Push to Contentful</Text>
        </Box>
        <Text dimColor>{'─'.repeat(40)}</Text>
      </Box>

      <Text>Writing component types and design tokens to your Contentful space...</Text>

      {operationId && (
        <Box gap={1}>
          <Text dimColor>Operation:</Text>
          <Text>{operationId}</Text>
        </Box>
      )}

      {showGlobal && progress && progress.kind === 'progress' && (
        <Box gap={1}>
          <Text color={PALETTE.info}>{SPINNER_FRAMES[frame]}</Text>
          <Text dimColor>
            {progress.processed}/{progress.total} entities
          </Text>
        </Box>
      )}

      {showCurrent && (
        <Box gap={1}>
          <Text dimColor>Now processing:</Text>
          <Text>{showCurrent}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Elapsed: {elapsedStr}</Text>
      </Box>
    </Box>
  );
}
