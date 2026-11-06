import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { openSupportBundle, supportInstruction } from '@tui/support-bundle.js';
import { useErrorControls } from './controls.js';
import { errorControls } from './logic.js';
import { useSupportBundle } from './use-support-bundle.js';

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
  const bundle = useSupportBundle();
  const canOpen = bundle !== undefined && bundle.status !== 'no-logs';
  useErrorControls({
    onExit,
    onRetry: onRetryCredentials,
    onAcknowledge: onAcknowledgeBreakingChanges,
    onOpen: canOpen ? () => openSupportBundle(bundle) : undefined,
  });

  const controls = errorControls({
    canRetry: onRetryCredentials !== undefined,
    canAcknowledge: onAcknowledgeBreakingChanges !== undefined,
    canOpen,
  });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold color={PALETTE.error}>
        ✗ {stepName} failed
      </Text>
      <Text color={PALETTE.error}>{message}</Text>
      {bundle && <Text color={PALETTE.muted}>{supportInstruction(bundle)}</Text>}
      <Box marginTop={1} gap={3}>
        {controls.map((control) => (
          <Text key={control.keys} color={PALETTE.muted}>
            [{control.keys}] {control.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
