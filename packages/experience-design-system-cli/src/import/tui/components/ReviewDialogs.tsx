import React from 'react';
import type { ComponentTypeSummary } from '@contentful/experience-design-system-types';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { FinalizeDialog } from '../../../analyze/select/tui/components/FinalizeDialog.js';
import { QuitDialog } from '../../../analyze/select/tui/components/QuitDialog.js';

export type ReviewFinalizeDialogsProps = {
  showFinalize: boolean;
  showQuit: boolean;
  accepted: number;
  rejected: number;
  needsReview: number;
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
  accepted,
  rejected,
  needsReview,
  removed,
  previewStatus,
  removedScrollOffset,
  onFinalizeConfirm,
  onFinalizeCancel,
  onQuitConfirm,
  onQuitCancel,
}: ReviewFinalizeDialogsProps): React.ReactElement {
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
