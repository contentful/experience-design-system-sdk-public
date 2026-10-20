import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { ControlHints } from '@tui/control-hints.js';
import { useGateControls } from './controls.js';
import { gateControls } from './logic.js';
import { StepHeader, type StepHeaderProps } from '../StepHeader.js';

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
  step?: StepHeaderProps['step'];
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
  step,
}: GateStepProps): React.ReactElement {
  useGateControls({ canSkip: onSkip !== undefined, onContinue, onSkip: onSkip ?? (() => {}), onQuit });

  const color = intent === 'error' ? PALETTE.error : PALETTE.success;
  const icon = intent === 'error' ? '✗' : '✓';

  return (
    <Box flexDirection="column">
      {step && <StepHeader step={step} />}
      <Box flexDirection="column" gap={1} paddingX={2} paddingTop={step ? 0 : 1} paddingBottom={1}>
        <Text color={color}>
          {icon} {message}
        </Text>
        {summary && <Text color={PALETTE.muted}>{summary}</Text>}
        {context && (
          <Box marginTop={1}>
            <Text>{context}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <ControlHints hints={gateControls(continueLabel, skipLabel, onSkip !== undefined)} />
        </Box>
      </Box>
    </Box>
  );
}
