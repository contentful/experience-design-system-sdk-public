import React from 'react';
import { Box, Text } from 'ink';
import type {
  LineageEntry,
  LineageJumpable,
} from '../../../../import/tui/hooks/useLineage.js';

export interface LineagePanelProps {
  focusedComponentKey: string;
  entries: LineageEntry[];
  /** Index into the jumpables list — NOT into entries. */
  cursor: number;
  jumpables: LineageJumpable[];
  /** Max entry rows rendered at once. Larger lineages window around the cursor. */
  maxRows?: number;
  /** Constrain the panel box to a fixed column width (e.g. the sidebar slot). */
  width?: number;
}

const DEFAULT_MAX_ROWS = 15;

/**
 * Entry-index start of the visible window. Keeps the cursor's source entry row
 * within the `maxRows`-tall slice, mirroring the sidebar's scroll-follow math.
 */
function windowStart(
  entries: LineageEntry[],
  jumpables: LineageJumpable[],
  cursor: number,
  maxRows: number,
): number {
  if (entries.length <= maxRows) return 0;
  const cursorEntryIdx = jumpables[cursor]?.i ?? 0;
  const maxStart = entries.length - maxRows;
  // Center-ish follow: keep the cursor row inside the window, clamped to bounds.
  let start = cursorEntryIdx - Math.floor(maxRows / 2);
  if (start < 0) start = 0;
  if (start > maxStart) start = maxStart;
  return start;
}

/**
 * Display-only lineage panel — open/close state stays with the parent step.
 * Rendering copied verbatim from ScopeGateStep's inline
 * `lineagePanelOpen && focusedComponent && (…)` block so both callsites
 * (ScopeGate + GenerateReview) share pixel-identical output.
 */
export function LineagePanel({
  focusedComponentKey,
  entries,
  cursor,
  jumpables,
  maxRows = DEFAULT_MAX_ROWS,
  width,
}: LineagePanelProps): React.ReactElement {
  // Window the entry list so the panel never exceeds a bounded height. An
  // unbounded panel taller than the terminal forces Ink to clear+repaint the
  // whole screen on every cursor move (each keypress re-renders), which the
  // operator sees as a flash on large lineages. Bounding the rendered rows
  // lets Ink diff in place. Distinct from L2's useLineage identity fix.
  const start = windowStart(entries, jumpables, cursor, maxRows);
  const end = Math.min(entries.length, start + maxRows);
  const visible = entries.slice(start, end);
  const moreAbove = start;
  const moreBelow = entries.length - end;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      marginTop={width === undefined ? 1 : 0}
      width={width}
      flexShrink={0}
    >
      <Text bold>{`Lineage: ${focusedComponentKey}`}</Text>
      {moreAbove > 0 && <Text dimColor>{`  ▲ ${moreAbove} more`}</Text>}
      {visible.map((e, vi) => {
        const i = start + vi;
        const jumpableIdx = jumpables.findIndex((j) => j.i === i);
        const isCursor = jumpableIdx === cursor && jumpableIdx >= 0;
        if (e.kind === 'section') {
          return (
            <Text key={i} bold>
              {'  '}
              {e.label}
            </Text>
          );
        }
        if (e.kind === 'empty') {
          return (
            <Text key={i}>
              <Text> </Text>
              <Text dimColor>{' ' + e.label}</Text>
            </Text>
          );
        }
        return (
          <Text key={i}>
            {isCursor ? (
              <Text color="cyan" bold>
                {'▶'}
              </Text>
            ) : (
              <Text> </Text>
            )}
            <Text inverse={isCursor}>{' ' + e.label}</Text>
          </Text>
        );
      })}
      {moreBelow > 0 && <Text dimColor>{`  ▼ ${moreBelow} more`}</Text>}
      <Text dimColor>[↑/↓] move · [Enter] jump · [l/Esc] close</Text>
    </Box>
  );
}
