import React from 'react';
import type { ComponentTypeSummary } from '@contentful/experience-design-system-types';
import { PALETTE } from '../theme.js';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../hooks/useImmediateInput.js';
import { removedComponentsHeader, removedComponentLine } from './removed-components-text.js';

/** Max removed-component lines shown at once; the rest scroll with j/k.
 *  Exported so the parent's scroll-offset clamping stays in sync. */
export const FINALIZE_REMOVED_WINDOW = 6;

type FinalizeDialogProps = {
  accepted: number;
  rejected: number;
  needsReview: number;
  onConfirm: () => void;
  onCancel: () => void;
  /** Components that will be DELETED from the target space on push, from a
   *  preview scoped to the accepted set. */
  removed?: ComponentTypeSummary[];
  /** Status of the accepted-set preview fired when the dialog opened. While
   *  'running', the deletion section shows a spinner instead of a (stale) list. */
  previewStatus?: 'idle' | 'running' | 'done' | 'error';
  /** Scroll offset into the removed list (owned by the parent; j/k adjust it). */
  removedScrollOffset?: number;
};

export function FinalizeDialog({
  accepted,
  rejected,
  needsReview,
  onConfirm,
  onCancel,
  removed = [],
  // Default 'done' so callers that pass a ready `removed` list (e.g. the atomic
  // review step) render it immediately without threading a status.
  previewStatus = 'done',
  removedScrollOffset = 0,
}: FinalizeDialogProps): React.ReactElement {
  useImmediateInput((input, key) => {
    // j/k scroll the removed list; the parent owns the offset (handled there).
    if (input === 'j' || input === 'k' || key.upArrow || key.downArrow) return;
    if (input === 'y' || key.return) {
      onConfirm();
    } else if (input === 'n' || key.escape) {
      onCancel();
    }
  });

  const allResolved = needsReview === 0;
  const noneAccepted = accepted === 0;

  const maxOffset = Math.max(0, removed.length - FINALIZE_REMOVED_WINDOW);
  const offset = Math.min(Math.max(0, removedScrollOffset), maxOffset);
  const windowed = removed.slice(offset, offset + FINALIZE_REMOVED_WINDOW);
  const hasMoreBelow = offset + FINALIZE_REMOVED_WINDOW < removed.length;
  const hasMoreAbove = offset > 0;

  return (
    <Box flexDirection="column" borderStyle="round" padding={1} width={58}>
      <Text bold>{'─'.repeat(17) + ' Finalize ' + '─'.repeat(17)}</Text>
      <Text> </Text>
      <Text>
        <Text color={PALETTE.success}>{accepted} accepted</Text>
        <Text> · </Text>
        <Text color={PALETTE.error}>{rejected} rejected</Text>
        <Text> · </Text>
        <Text dimColor>{needsReview} unresolved</Text>
      </Text>
      <Text> </Text>
      {noneAccepted && (
        <>
          <Text bold color={PALETTE.warning}>
            {'⚠ No components are accepted — nothing will be pushed.'}
          </Text>
          <Text color={PALETTE.warning}>{'  Accept at least one component ([a] a row, [A] accept all) to push.'}</Text>
          <Text> </Text>
        </>
      )}
      {!allResolved && (
        <>
          <Text color={PALETTE.warning}>
            {'⚠ ' + needsReview + ' unresolved component' + (needsReview === 1 ? '' : 's') + ' will not be pushed.'}
          </Text>
          <Text color={PALETTE.warning}>{'  Only explicitly accepted components ship.'}</Text>
          <Text> </Text>
        </>
      )}
      {previewStatus === 'running' && (
        <>
          <Text dimColor>Previewing deletions against the target space…</Text>
          <Text> </Text>
        </>
      )}
      {previewStatus === 'error' && (
        <>
          <Text color={PALETTE.warning}>{'⚠ Could not preview deletions (the push will still proceed).'}</Text>
          <Text> </Text>
        </>
      )}
      {previewStatus === 'done' && removed.length > 0 && (
        <>
          <Text bold color={PALETTE.error}>
            {removedComponentsHeader(removed.length, false)}
          </Text>
          {hasMoreAbove && <Text dimColor>{'  ↑ more above'}</Text>}
          {windowed.map((rc) => (
            <Text key={rc.id} color={PALETTE.error}>
              {removedComponentLine(rc)}
            </Text>
          ))}
          {hasMoreBelow && <Text dimColor>{'  ↓ more below'}</Text>}
          {removed.length > FINALIZE_REMOVED_WINDOW && <Text dimColor>{'  [j/k] scroll deletions'}</Text>}
          <Text> </Text>
        </>
      )}
      <Text>
        {noneAccepted
          ? 'Confirm exit with nothing accepted?'
          : allResolved
            ? 'Save decisions and exit? All components resolved.'
            : 'Save decisions and exit?'}
      </Text>
      <Text> </Text>
      <Text>{'  [y / Enter]  Confirm    [n / Esc]  Cancel'}</Text>
    </Box>
  );
}
