import React, { useMemo, useState } from 'react';
import { Box, Text, type Key } from 'ink';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { PALETTE } from '../../../home/home.theme.js';
import { useTerminalRows } from '../../../use-terminal-rows.js';
import { controlsFor, usePreviewGateControls } from './controls.js';
import {
  buildDiffLines,
  buildSummaryLines,
  hasChanges,
  nextScrollOffset,
  scrollIndicator,
  viewportHeight,
} from './logic.js';

export type PreviewGateResult =
  | { action: 'confirm'; acknowledgeBreaking: boolean }
  | { action: 'edit' }
  | { action: 'quit' };

interface PreviewGateScreenProps {
  preview: ServerPreviewResponse;
  spaceId: string;
  environmentId: string;
  hasBreakingChanges: boolean;
  onDone: (result: PreviewGateResult) => void;
}

export function PreviewGateScreen({
  preview,
  spaceId,
  environmentId,
  hasBreakingChanges,
  onDone,
}: PreviewGateScreenProps): React.ReactElement {
  const [diffExpanded, setDiffExpanded] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const terminalRows = useTerminalRows();

  const summaryLines = useMemo(() => buildSummaryLines(preview), [preview]);
  const diffLines = useMemo(() => buildDiffLines(preview), [preview]);
  const lines = diffExpanded ? diffLines : summaryLines;

  const height = viewportHeight(terminalRows, hasBreakingChanges);
  const maxScroll = Math.max(0, lines.length - height);
  const offset = Math.min(scrollOffset, maxScroll);

  const scroll = (input: string, key: Key): void => {
    setScrollOffset((previous) =>
      nextScrollOffset(input, key, diffExpanded, {
        offset: Math.min(previous, maxScroll),
        viewportHeight: height,
        maxScroll,
      }),
    );
  };

  usePreviewGateControls({
    diffExpanded,
    onConfirm: () => onDone({ action: 'confirm', acknowledgeBreaking: hasBreakingChanges }),
    onToggleDiff: () => {
      setDiffExpanded((previous) => !previous);
      setScrollOffset(0);
    },
    onEdit: () => onDone({ action: 'edit' }),
    onQuit: () => onDone({ action: 'quit' }),
    onScroll: scroll,
  });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Box flexDirection="column">
        <Text bold>Push to Contentful</Text>
        <Text dimColor>
          Space {spaceId} · Environment {environmentId}
        </Text>
      </Box>

      {hasChanges(preview) ? (
        <>
          <Text>Here&apos;s what will happen in your space:</Text>
          <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.border} paddingX={1}>
            {diffExpanded && <Text bold>Diff ({diffLines.length} lines)</Text>}
            {lines.slice(offset, offset + height).map((line) => (
              <Text key={line.key} color={line.color === 'gray' ? PALETTE.muted : line.color} wrap="truncate-end">
                {line.text}
              </Text>
            ))}
            <Text color={PALETTE.muted} wrap="truncate-end">
              {scrollIndicator(lines.length, offset, height)}
            </Text>
          </Box>
        </>
      ) : (
        <Text color={PALETTE.muted}>Nothing to push — everything is already up to date.</Text>
      )}

      {hasBreakingChanges && (
        <Text color={PALETTE.error} bold>
          ⚠ Breaking changes will affect downstream entities. Press Enter to acknowledge and apply.
        </Text>
      )}

      <Box marginTop={1} columnGap={3} flexWrap="wrap">
        {controlsFor(diffExpanded, hasBreakingChanges).map((control) => (
          <Text key={control.keys} dimColor>
            [{control.keys}] {control.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
