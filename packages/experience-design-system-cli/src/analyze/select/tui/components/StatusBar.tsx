import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../theme.js';

type StatusBarProps = {
  accepted: number;
  rejected: number;
  reviewed: number;
  needsReview: number;
  onApproveAll: () => void;
  onFinalize: () => void;
};

export function StatusBar({ accepted, rejected, reviewed, needsReview }: StatusBarProps): React.ReactElement {
  const allResolved = needsReview === 0;

  return (
    <Box gap={2} flexWrap="wrap">
      <Text color={PALETTE.success}>{accepted} accepted</Text>
      <Text color={PALETTE.error}>{rejected} rejected</Text>
      <Text dimColor>{needsReview} pending</Text>
      <Text color={PALETTE.info}>{reviewed} reviewed</Text>
      <Text dimColor>·</Text>
      <Text dimColor>[A] accept all</Text>
      <Text bold={allResolved} color={allResolved ? PALETTE.success : PALETTE.fg}>
        [F] finalize
      </Text>
    </Box>
  );
}
