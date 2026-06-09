import React from 'react';
import { Box, Text } from 'ink';

type StatusBarProps = {
  accepted: number;
  rejected: number;
  reviewed: number;
  needsReview: number;
};

export function StatusBar({ accepted, rejected, reviewed, needsReview }: StatusBarProps): React.ReactElement {
  const allResolved = needsReview === 0;

  return (
    <Box gap={2} flexWrap="wrap">
      <Text color="green">{accepted} accepted</Text>
      <Text color="red">{rejected} rejected</Text>
      <Text dimColor>{needsReview} pending</Text>
      <Text color="cyan">{reviewed} reviewed</Text>
      <Text dimColor>·</Text>
      <Text dimColor>[A] accept all</Text>
      <Text bold={allResolved} color={allResolved ? 'green' : 'white'}>
        [F] finalize
      </Text>
    </Box>
  );
}
