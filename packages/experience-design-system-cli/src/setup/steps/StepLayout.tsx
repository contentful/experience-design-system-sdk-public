import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../analyze/select/tui/theme.js';

export type StepStatus = 'completed' | 'skipped' | 'failed';

/** What a step reports back to the wizard when it finishes. */
export type StepDone = (status: StepStatus) => void;

type StepLayoutProps = {
  /** Explanation of the setting, rendered dimmed below the prompt. */
  helpText?: string;
  /** Lines the step has already resolved, rendered above the prompt. */
  children: React.ReactNode;
  /** The active prompt, if the step is waiting on input. */
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
  const padded = label.padEnd('Environment ID'.length + 2);
  if (!value) return <StepWarning>{`${padded}(not set)`}</StepWarning>;
  return <Text> {`${padded}${value}`}</Text>;
}
