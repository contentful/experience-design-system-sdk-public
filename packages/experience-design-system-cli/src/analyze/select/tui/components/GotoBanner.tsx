import React from 'react';
import { Box, Text } from 'ink';

export interface GotoRow {
  label: string;
  jumpTarget: string;
  kind?: string;
}

export interface GotoBannerProps {
  title: string;
  rows: GotoRow[];
  /** Index used to highlight + window. Indexes `rows` directly by default. */
  cursor: number;
  /**
   * Override the row index the cursor sits on, when `cursor` indexes a subset
   * (e.g. a jumpable projection) rather than `rows`. Windowing and the default
   * highlight center on this instead of `cursor` when provided.
   */
  cursorRowIndex?: number;
  /** Max rows rendered at once. Larger lists window around the cursor. */
  maxRows?: number;
  /** Constrain the box to a fixed column width (e.g. the sidebar slot). */
  width?: number;
  /** Footer keybinding hint. Rendered dim below the list when given. */
  footerHint?: string;
  /**
   * Escape hatch for feature-specific row rendering. Receives the row, its
   * index into `rows`, and whether the cursor is on it. Falls back to a
   * generic ▶-pointer row.
   */
  renderRow?: (row: GotoRow, index: number, isCursor: boolean) => React.ReactElement;
}

const DEFAULT_MAX_ROWS = 15;

/**
 * Entry-index start of the visible window. Keeps the highlighted row within the
 * `maxRows`-tall slice, mirroring the sidebar's scroll-follow math.
 */
function windowStart(rowCount: number, highlightIndex: number, maxRows: number): number {
  if (rowCount <= maxRows) return 0;
  const maxStart = rowCount - maxRows;
  let start = highlightIndex - Math.floor(maxRows / 2);
  if (start < 0) start = 0;
  if (start > maxStart) start = maxStart;
  return start;
}

function defaultRenderRow(
  row: GotoRow,
  index: number,
  isCursor: boolean,
): React.ReactElement {
  return (
    <Text key={index}>
      {isCursor ? (
        <Text color="cyan" bold>
          {'▶'}
        </Text>
      ) : (
        <Text> </Text>
      )}
      <Text inverse={isCursor}>{' ' + row.label}</Text>
    </Text>
  );
}

/**
 * Generic bordered "goto" overlay: a windowed list of jump targets with a
 * title, ▲/▼ overflow indicators, and an optional footer hint. Display-only —
 * open/close and key handling stay with the parent step, which owns the cursor.
 */
export function GotoBanner({
  title,
  rows,
  cursor,
  cursorRowIndex,
  maxRows = DEFAULT_MAX_ROWS,
  width,
  footerHint,
  renderRow = defaultRenderRow,
}: GotoBannerProps): React.ReactElement {
  const highlightIndex = cursorRowIndex ?? cursor;
  const start = windowStart(rows.length, highlightIndex, maxRows);
  const end = Math.min(rows.length, start + maxRows);
  const visible = rows.slice(start, end);
  const moreAbove = start;
  const moreBelow = rows.length - end;

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
      <Text bold>{title}</Text>
      {moreAbove > 0 && <Text dimColor>{`  ▲ ${moreAbove} more`}</Text>}
      {visible.map((row, vi) => {
        const i = start + vi;
        return renderRow(row, i, i === highlightIndex);
      })}
      {moreBelow > 0 && <Text dimColor>{`  ▼ ${moreBelow} more`}</Text>}
      {footerHint !== undefined && <Text dimColor>{footerHint}</Text>}
    </Box>
  );
}
