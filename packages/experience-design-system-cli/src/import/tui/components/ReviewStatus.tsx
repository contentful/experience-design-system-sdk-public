import React from 'react';
import { Box, Text } from 'ink';
import type { ReviewComponentStatus } from '../../../analyze/select/types.js';
import { PALETTE } from '../../../analyze/select/tui/theme.js';

export type ReviewStatusCounts = {
  accepted: number;
  rejected: number;
  needsReview: number;
};

type ReviewStatusEntry = {
  status: ReviewComponentStatus;
};

export function countReviewStatuses(entries: ReadonlyArray<ReviewStatusEntry>): ReviewStatusCounts {
  return entries.reduce<ReviewStatusCounts>(
    (counts, entry) => {
      if (entry.status === 'accepted') counts.accepted += 1;
      if (entry.status === 'rejected') counts.rejected += 1;
      if (entry.status === 'needs-review') counts.needsReview += 1;
      return counts;
    },
    { accepted: 0, rejected: 0, needsReview: 0 },
  );
}

export function ReviewLoadingState(): React.ReactElement {
  return (
    <Box paddingX={2} paddingY={1}>
      <Text dimColor>Loading generated definitions...</Text>
    </Box>
  );
}

export function ReviewLoadError({ message }: { message: string }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color={PALETTE.error}>{message}</Text>
      <Text> </Text>
      <Text dimColor>[q / Enter / Esc] Quit</Text>
    </Box>
  );
}
