import React from 'react';
import { Box, Text } from 'ink';
import type { PreviewAnnotation } from '../../../analyze/select/types.js';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import type { UseLivePreviewReturn } from '../useLivePreview.js';

type LivePreviewSummaryProps = {
  enabled: boolean;
  previewAnnotations: ReadonlyMap<string, PreviewAnnotation>;
  status: UseLivePreviewReturn['status'];
  disabled: boolean;
  spinner: string;
  removedCount?: number;
  showRemovedListHint?: boolean;
};

export function LivePreviewSummary({
  enabled,
  previewAnnotations,
  status,
  disabled,
  spinner,
  removedCount = 0,
  showRemovedListHint = false,
}: LivePreviewSummaryProps): React.ReactElement | null {
  if (!enabled) return null;

  const counts: Record<PreviewAnnotation, number> = { new: 0, changed: 0, removed: 0, breaking: 0 };
  for (const annotation of previewAnnotations.values()) counts[annotation] += 1;
  const hasCounts = counts.new + counts.changed + counts.removed + counts.breaking > 0;

  if (disabled) return <Text dimColor>{'Preview: disabled (creds rejected)'}</Text>;
  if (status === 'running' && !hasCounts) return <Text dimColor>{`Preview: ${spinner} running...`}</Text>;
  if (!hasCounts) return null;

  return (
    <Box>
      <Text>{'Preview: '}</Text>
      <Text color={PALETTE.success}>{`${counts.new} new`}</Text>
      <Text>{' · '}</Text>
      <Text color={PALETTE.warning}>{`${counts.changed} changed`}</Text>
      <Text>{' · '}</Text>
      <Text dimColor>{`${counts.removed} removed`}</Text>
      {showRemovedListHint && removedCount > 0 && <Text dimColor>{' ([d] removed list)'}</Text>}
      <Text>{' · '}</Text>
      <Text color={PALETTE.error} bold>
        {`${counts.breaking} breaking`}
      </Text>
    </Box>
  );
}
