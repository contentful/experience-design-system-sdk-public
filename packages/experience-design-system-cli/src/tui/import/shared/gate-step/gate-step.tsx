import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../home/home.theme.js';
import { useGateControls } from './controls.js';
import { gateControls } from './logic.js';

interface GateStepProps {
  message: string;
  onContinue: () => void;
  onQuit: () => void;
  summary?: string;
  context?: string;
  continueLabel?: string;
  skipLabel?: string;
  onSkip?: () => void;
  intent?: 'success' | 'error';
}

export function GateStep({
  message,
  onContinue,
  onQuit,
  summary,
  context,
  continueLabel = 'Continue',
  skipLabel = 'Approve all and skip',
  onSkip,
  intent = 'success',
}: GateStepProps): React.ReactElement {
  useGateControls({ canSkip: onSkip !== undefined, onContinue, onSkip: onSkip ?? (() => {}), onQuit });

  const color = intent === 'error' ? PALETTE.error : PALETTE.success;
  const icon = intent === 'error' ? '✗' : '✓';

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text color={color}>
        {icon} {message}
      </Text>
      {summary && <Text color={PALETTE.muted}>{summary}</Text>}
      {context && (
        <Box marginTop={1}>
          <Text>{context}</Text>
        </Box>
      )}
      <Box marginTop={1} gap={3}>
        {gateControls(continueLabel, skipLabel, onSkip !== undefined).map((control) => (
          <Text key={control.keys} dimColor>
            [{control.keys}] {control.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
