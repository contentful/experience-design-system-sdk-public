import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../analyze/select/tui/theme.js';

export type StepStatus = 'completed' | 'skipped' | 'failed';

/** What a step reports back to the wizard when it finishes. */
export type StepDone = (status: StepStatus) => void;

type StepLayoutProps = {
  helpText?: string;
  children: React.ReactNode;
  prompt?: React.ReactNode;
};

export function StepLayout({ helpText, children, prompt }: StepLayoutProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {children}
      {prompt && <Box marginTop={1}>{prompt}</Box>}
      {helpText && (
        <Box marginTop={1}>
          <Text dimColor>{helpText}</Text>
        </Box>
      )}
    </Box>
  );
}

export function StepSuccess({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text color={PALETTE.success}>✓ {children}</Text>;
}

export function StepWarning({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Text color={PALETTE.warning}>⚠ {children}</Text>;
}

export function StepValue({ label, value }: { label: string; value: string | undefined }): React.ReactElement {
  const color = value ? undefined : PALETTE.warning;
  return (
    <Box>
      <Box width={2}>
        <Text color={color}>{value ? '' : '⚠'}</Text>
      </Box>
      <Box width={20} flexShrink={0}>
        <Text color={color}>{label}</Text>
      </Box>
      <Text color={color}>{value || '(not set)'}</Text>
    </Box>
  );
}
