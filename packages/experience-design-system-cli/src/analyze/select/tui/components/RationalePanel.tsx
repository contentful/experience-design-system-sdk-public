import React from 'react';
import { PALETTE } from '../theme.js';
import { Box, Text } from 'ink';

export type RationaleRow = {
  name: string;
  kind: 'prop' | 'slot';
  rationale: string;
};

export type RationalePanelProps = {
  componentName: string;
  rows: RationaleRow[];
  scrollOffset: number;
  width: number;
  height: number;
  active: boolean;
};

/**
 * Word-wrap a single rationale paragraph to fit within `innerWidth` columns.
 * Returns an array of wrapped lines. Empty input → single empty line so the
 * row still occupies vertical space.
 */
function wrapText(text: string, innerWidth: number): string[] {
  if (!text) return [''];
  const width = Math.max(1, innerWidth);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (current.length === 0) {
      // Word longer than width — hard-break.
      if (w.length > width) {
        let rest = w;
        while (rest.length > width) {
          lines.push(rest.slice(0, width));
          rest = rest.slice(width);
        }
        current = rest;
      } else {
        current = w;
      }
      continue;
    }
    if (current.length + 1 + w.length <= width) {
      current += ' ' + w;
    } else {
      lines.push(current);
      if (w.length > width) {
        let rest = w;
        while (rest.length > width) {
          lines.push(rest.slice(0, width));
          rest = rest.slice(width);
        }
        current = rest;
      } else {
        current = w;
      }
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

type RenderedLine =
  | { kind: 'name'; text: string; isSlot: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'blank' };

/**
 * Flatten `rows` to a list of rendered lines so scrollOffset slicing matches
 * what the operator sees. Layout per row:
 *   <name>           ← bold
 *   <wrapped text>   ← one or more lines
 *   <blank>          ← spacer (omitted after the final row)
 */
export function renderRationaleLines(rows: RationaleRow[], innerWidth: number): RenderedLine[] {
  const out: RenderedLine[] = [];
  rows.forEach((row, idx) => {
    out.push({ kind: 'name', text: row.name, isSlot: row.kind === 'slot' });
    for (const line of wrapText(row.rationale, innerWidth)) {
      out.push({ kind: 'text', text: line });
    }
    if (idx < rows.length - 1) {
      out.push({ kind: 'blank' });
    }
  });
  return out;
}

export function RationalePanel({
  componentName,
  rows,
  scrollOffset,
  width,
  height,
  active,
}: RationalePanelProps): React.ReactElement {
  const innerWidth = Math.max(1, width - 2); // subtract border
  const allLines = renderRationaleLines(rows, innerWidth);
  const totalLines = allLines.length;
  const visible = allLines.slice(scrollOffset, scrollOffset + height);
  const overflowed = totalLines > height;
  const visibleStart = totalLines === 0 ? 0 : scrollOffset + 1;
  const visibleEnd = Math.min(totalLines, scrollOffset + height);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height + 2} // +2 for borders
      borderStyle="single"
      borderColor={active ? PALETTE.inverse : undefined}
    >
      <Box>
        <Text bold dimColor={!active}>
          {`RATIONALE — ${componentName}`}
        </Text>
        {overflowed && (
          <>
            <Box flexGrow={1} />
            <Text dimColor={!active}>{`↕ ${visibleStart}-${visibleEnd}/${totalLines}`}</Text>
          </>
        )}
      </Box>
      {visible.map((line, i) => {
        if (line.kind === 'blank') {
          return (
            <Box key={i}>
              <Text> </Text>
            </Box>
          );
        }
        if (line.kind === 'name') {
          return (
            <Box key={i}>
              <Text bold color={PALETTE.info} dimColor={!active}>
                {line.text}
              </Text>
              {line.isSlot && <Text dimColor> (slot)</Text>}
            </Box>
          );
        }
        return (
          <Box key={i}>
            <Text dimColor={!active}>{line.text}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
