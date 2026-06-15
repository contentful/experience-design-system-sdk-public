import React from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

type GateStepProps = {
  successMessage: string;
  summary?: string;
  context: string;
  continueLabel?: string;
  skipLabel?: string;
  onContinue: () => void;
  onSkip?: () => void;
  onQuit: () => void;
  showSkip?: boolean;
  intent?: 'success' | 'error';
};

export function GateStep({
  successMessage,
  summary,
  context,
  continueLabel = 'Continue',
  skipLabel = 'Approve all and skip',
  onContinue,
  onSkip,
  onQuit,
  showSkip = true,
  intent = 'success',
}: GateStepProps): React.ReactElement {
  useImmediateInput((input, key) => {
    if (key.return) {
      onContinue();
      return;
    }
    if (input === 'a' && showSkip && onSkip) {
      onSkip();
      return;
    }
    if (input === 'q' || key.escape) {
      onQuit();
      return;
    }
  });

  const headerColor = intent === 'error' ? 'red' : 'green';
  const headerIcon = intent === 'error' ? '✗' : '✓';
  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text color={headerColor}>
        {headerIcon} {successMessage}
      </Text>
      {summary && <Text dimColor>{summary}</Text>}

      <Box marginTop={1}>
        <Text>{context}</Text>
      </Box>

      <Box gap={3} marginTop={1}>
        <Text dimColor>[Enter] {continueLabel}</Text>
        {showSkip && onSkip && <Text dimColor>[a] {skipLabel}</Text>}
        <Text dimColor>[q] Quit</Text>
      </Box>
    </Box>
  );
}
