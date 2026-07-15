import { Box, Text } from 'ink';
import React from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';

export type AutoFilterStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';

export function AutoFilterBanner(props: {
  status?: AutoFilterStatus;
  progress?: { done: number; total: number } | null;
  error?: string | null;
}): React.ReactElement | null {
  const { status, progress, error } = props;

  const showRunningHeader = status === 'running' && progress !== null && progress !== undefined && progress.total > 0;
  const showCancelledBanner = status === 'cancelled';
  const showFailedBanner = status === 'failed';

  if (showRunningHeader) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={PALETTE.info}>
          [AI filtering ({progress!.done}/{progress!.total})…] <Text dimColor>[q] cancels</Text>
        </Text>
      </Box>
    );
  }

  if (showCancelledBanner) {
    return (
      <Box marginTop={1}>
        <Text color={PALETTE.warning}>
          AI auto-filter cancelled
          {progress ? ` at ${progress.done}/${progress.total}` : ''}. Review remaining manually.
        </Text>
      </Box>
    );
  }

  if (showFailedBanner) {
    return (
      <Box marginTop={1}>
        <Text color={PALETTE.warning}>
          AI auto-filter failed: {error ?? 'unknown error'}. Continuing without AI suggestions.
        </Text>
      </Box>
    );
  }

  return null;
}
