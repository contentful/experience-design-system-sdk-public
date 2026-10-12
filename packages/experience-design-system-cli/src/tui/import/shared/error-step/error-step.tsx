import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../home/home.theme.js';
import { useErrorControls } from './controls.js';
import { errorControls } from './logic.js';

interface ErrorStepProps {
  stepName: string;
  message: string;
  onExit: () => void;
  onRetryCredentials?: () => void;
  onAcknowledgeBreakingChanges?: () => void;
}

export function ErrorStep({
  stepName,
  message,
  onExit,
  onRetryCredentials,
  onAcknowledgeBreakingChanges,
}: ErrorStepProps): React.ReactElement {
  useErrorControls({ onExit, onRetry: onRetryCredentials, onAcknowledge: onAcknowledgeBreakingChanges });

  const controls = errorControls({
    canRetry: onRetryCredentials !== undefined,
    canAcknowledge: onAcknowledgeBreakingChanges !== undefined,
  });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold color={PALETTE.error}>
        ✗ {stepName} failed
      </Text>
      <Text color={PALETTE.error}>{message}</Text>
      <Box marginTop={1} gap={3}>
        {controls.map((control) => (
          <Text key={control.keys} dimColor>
            [{control.keys}] {control.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
