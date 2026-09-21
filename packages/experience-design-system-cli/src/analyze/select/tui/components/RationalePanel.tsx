import React from 'react';
import { PALETTE } from '../theme.js';
import { Text } from 'ink';
import { wrapText } from './wrap-text.js';
import { RationaleLine, type RationaleLineData } from './RationaleLine.js';
import { ScrollablePanel } from './ScrollablePanel.js';

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

type RenderedLine = RationaleLineData;

function renderRationaleLines(rows: RationaleRow[], innerWidth: number): RenderedLine[] {
  const out: RenderedLine[] = [];
  rows.forEach((row, idx) => {
    out.push({
      kind: 'label',
      text: row.name,
      color: PALETTE.info,
      suffix: row.kind === 'slot' ? ' (slot)' : undefined,
    });
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
  const visibleStart = totalLines === 0 ? 0 : scrollOffset + 1;
  const visibleEnd = Math.min(totalLines, scrollOffset + height);

  return (
    <ScrollablePanel
      header={
        <Text bold dimColor={!active}>
          {`RATIONALE — ${componentName}`}
        </Text>
      }
      width={width}
      height={height}
      active={active}
      totalLines={totalLines}
      visibleStart={visibleStart}
      visibleEnd={visibleEnd}
      borderColor={active ? PALETTE.inverse : undefined}
    >
      {visible.map((line, i) => (
        <RationaleLine key={i} line={line} active={active} />
      ))}
    </ScrollablePanel>
  );
}
