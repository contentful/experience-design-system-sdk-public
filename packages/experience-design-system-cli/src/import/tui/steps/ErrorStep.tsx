import React from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

type ErrorStepProps = {
  stepName: string;
  message: string;
  onExit: () => void;
  onRetryCredentials?: () => void;
  onAcknowledgeBreakingChanges?: () => void;
};

export function ErrorStep({
  stepName,
  message,
  onExit,
  onRetryCredentials,
  onAcknowledgeBreakingChanges,
}: ErrorStepProps): React.ReactElement {
  useImmediateInput((input, key) => {
    if (key.return && onAcknowledgeBreakingChanges) {
      onAcknowledgeBreakingChanges();
      return;
    }
    if (input === 'r' && onRetryCredentials) {
      onRetryCredentials();
      return;
    }
    if (key.return || input === 'q' || key.escape) {
      onExit();
    }
  });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold color={PALETTE.error}>
        ✗ {stepName} failed
      </Text>
      <Text color={PALETTE.error}>{message}</Text>
      <Box gap={3} marginTop={1}>
        {onAcknowledgeBreakingChanges ? (
          <>
            <Text dimColor>[Enter] Acknowledge and apply</Text>
            <Text dimColor>[Esc / q] Exit</Text>
          </>
        ) : (
          <Text dimColor>[Enter / q] Exit</Text>
        )}
        {onRetryCredentials && <Text dimColor>[r] Re-enter credentials</Text>}
      </Box>
    </Box>
  );
}
