import React from 'react';
import type { ComponentTypeSummary } from '@contentful/experience-design-system-types';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { FinalizeDialog } from '../../../analyze/select/tui/components/FinalizeDialog.js';
import { QuitDialog } from '../../../analyze/select/tui/components/QuitDialog.js';
import type { UseFinalizePreviewReturn } from '../useFinalizePreview.js';
import type { UseReviewSurfaceStateResult } from '../hooks/useReviewSurfaceState.js';
import { countReviewStatuses, type ReviewStatusEntry } from './ReviewStatus.js';

export type ReviewFinalizeDialogsProps = {
  showFinalize: boolean;
  showQuit: boolean;
  components: ReadonlyArray<ReviewStatusEntry>;
  removed?: ComponentTypeSummary[];
  previewStatus?: 'idle' | 'running' | 'done' | 'error';
  removedScrollOffset?: number;
  onFinalizeConfirm: () => void;
  onFinalizeCancel: () => void;
  onQuitConfirm: () => void;
  onQuitCancel: () => void;
};

export function ReviewFinalizeDialogs({
  showFinalize,
  showQuit,
  components,
  removed,
  previewStatus,
  removedScrollOffset,
  onFinalizeConfirm,
  onFinalizeCancel,
  onQuitConfirm,
  onQuitCancel,
}: ReviewFinalizeDialogsProps): React.ReactElement {
  const { accepted, rejected, needsReview } = countReviewStatuses(components);
  return (
    <>
      {showFinalize && (
        <FinalizeDialog
          accepted={accepted}
          rejected={rejected}
          needsReview={needsReview}
          removed={removed}
          previewStatus={previewStatus}
          removedScrollOffset={removedScrollOffset}
          onConfirm={onFinalizeConfirm}
          onCancel={onFinalizeCancel}
        />
      )}
      {showQuit && <QuitDialog hasUnsavedDrafts={false} onConfirm={onQuitConfirm} onCancel={onQuitCancel} />}
    </>
  );
}

export function ReviewStepDialogs({
  surfaceState,
  components,
  finalizePreview,
  onFinalize,
  onQuit,
}: {
  surfaceState: UseReviewSurfaceStateResult;
  components: ReadonlyArray<ReviewStatusEntry>;
  finalizePreview: UseFinalizePreviewReturn;
  onFinalize: () => void;
  onQuit: () => void;
}): React.ReactElement {
  return (
    <ReviewFinalizeDialogs
      showFinalize={surfaceState.showFinalize}
      showQuit={surfaceState.showQuit}
      components={components}
      removed={finalizePreview.removed}
      previewStatus={finalizePreview.status}
      removedScrollOffset={finalizePreview.scrollOffset}
      onFinalizeConfirm={onFinalize}
      onFinalizeCancel={() => surfaceState.setShowFinalize(false)}
      onQuitConfirm={onQuit}
      onQuitCancel={() => surfaceState.setShowQuit(false)}
    />
  );
}

export function ReviewReloadDialog({ open }: { open: boolean }): React.ReactElement | null {
  if (!open) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.warning} paddingX={1}>
      <Text bold color={PALETTE.warning}>
        Reload from saved state?
      </Text>
      <Text>Unsaved in-memory changes will be lost.</Text>
      <Text> </Text>
      <Text>{'  [Enter]  Confirm'}</Text>
      <Text>{'  [Esc]    Cancel'}</Text>
    </Box>
  );
}
