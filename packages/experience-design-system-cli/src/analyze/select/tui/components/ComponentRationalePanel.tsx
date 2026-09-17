import React from 'react';
import { PALETTE } from '../theme.js';
import { Box, Text } from 'ink';
import type { ComponentRationale } from '../../../../session/db.js';
import { wrapText } from './wrap-text.js';
import { RationaleLine, type RationaleLineData } from './RationaleLine.js';

export type ComponentRationalePanelProps = {
  data: ComponentRationale;
  scrollOffset: number;
  width: number;
  height: number;
  active: boolean;
};

const PLACEHOLDER = '(no rationale captured)';

type RenderedLine = RationaleLineData;

function renderComponentRationaleLines(data: ComponentRationale, innerWidth: number): RenderedLine[] {
  const out: RenderedLine[] = [];

  const pushSection = (heading: string, body: string | null) => {
    out.push({ kind: 'heading', text: heading });
    const text = body && body.trim().length > 0 ? body : PLACEHOLDER;
    for (const line of wrapText(text, Math.max(1, innerWidth - 2))) {
      out.push({ kind: 'text', text: '  ' + line, dim: !body });
    }
    out.push({ kind: 'blank' });
  };

  out.push({ kind: 'heading', text: 'Description' });
  const descBody = data.description && data.description.trim().length > 0 ? data.description : PLACEHOLDER;
  for (const line of wrapText(descBody, Math.max(1, innerWidth - 2))) {
    out.push({ kind: 'text', text: '  ' + line, dim: !data.description });
  }
  if (data.descriptionRationale && data.descriptionRationale.trim().length > 0) {
    for (const line of wrapText(`why: ${data.descriptionRationale}`, Math.max(1, innerWidth - 2))) {
      out.push({ kind: 'text', text: '  ' + line, dim: true });
    }
  }
  out.push({ kind: 'blank' });
  pushSection('Why these props', data.propsRationale);
  pushSection('Why these slots', data.slotsRationale);

  out.push({ kind: 'heading', text: 'Props' });
  if (data.props.length === 0) {
    out.push({ kind: 'text', text: '  ' + PLACEHOLDER, dim: true });
  } else {
    for (const p of data.props) {
      const sub = p.category ? `(${p.category})` : undefined;
      out.push({ kind: 'label', text: p.name, prefix: '  - ', suffix: sub ? ' ' + sub : undefined });
      const text = p.rationale && p.rationale.trim().length > 0 ? p.rationale : PLACEHOLDER;
      for (const line of wrapText(text, Math.max(1, innerWidth - 4))) {
        out.push({ kind: 'text', text: '    ' + line, dim: !p.rationale });
      }
    }
  }
  out.push({ kind: 'blank' });

  out.push({ kind: 'heading', text: 'Slots' });
  if (data.slots.length === 0) {
    out.push({ kind: 'text', text: '  ' + PLACEHOLDER, dim: true });
  } else {
    for (const s of data.slots) {
      out.push({ kind: 'label', text: s.name, prefix: '  - ' });
      const text = s.rationale && s.rationale.trim().length > 0 ? s.rationale : PLACEHOLDER;
      for (const line of wrapText(text, Math.max(1, innerWidth - 4))) {
        out.push({ kind: 'text', text: '    ' + line, dim: !s.rationale });
      }
    }
  }

  return out;
}

export function ComponentRationalePanel({
  data,
  scrollOffset,
  width,
  height,
  active,
}: ComponentRationalePanelProps): React.ReactElement {
  const innerWidth = Math.max(1, width - 2);
  const all = renderComponentRationaleLines(data, innerWidth);
  const totalLines = all.length;
  const contentHeight = Math.max(1, height - 1);
  const visible = all.slice(scrollOffset, scrollOffset + contentHeight);
  const overflowed = totalLines > contentHeight;
  const visibleStart = totalLines === 0 ? 0 : scrollOffset + 1;
  const visibleEnd = Math.min(totalLines, scrollOffset + contentHeight);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height + 2}
      borderStyle="single"
      borderColor={active ? PALETTE.inverse : undefined}
    >
      <Box>
        <Text bold dimColor={!active}>
          {`Component rationale: ${data.name}`}
        </Text>
      </Box>
      {visible.map((line, i) => (
        <RationaleLine key={i} line={line} active={active} />
      ))}
      <Box>
        {overflowed ? (
          <Text dimColor>{`${visibleStart}-${visibleEnd}/${totalLines}    [j/k] scroll    [I/Esc] close`}</Text>
        ) : (
          <Text dimColor>{'[I/Esc] close'}</Text>
        )}
      </Box>
    </Box>
  );
}
