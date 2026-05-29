import React from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

type ErrorStepProps = {
  stepName: string;
  message: string;
  onExit: () => void;
  onRetryCredentials?: () => void;
};

export function ErrorStep({ stepName, message, onExit, onRetryCredentials }: ErrorStepProps): React.ReactElement {
  useImmediateInput((input, key) => {
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
      <Text bold color="red">
        ✗ {stepName} failed
      </Text>
      <Text color="red">{message}</Text>
      <Box gap={3} marginTop={1}>
        <Text dimColor>[Enter / q] Exit</Text>
        {onRetryCredentials && <Text dimColor>[r] Re-enter credentials</Text>}
      </Box>
    </Box>
  );
}
