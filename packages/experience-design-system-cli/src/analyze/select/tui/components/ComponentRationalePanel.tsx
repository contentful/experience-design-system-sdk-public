import React from 'react';
import { PALETTE } from '../theme.js';
import { Box, Text } from 'ink';
import type { ComponentRationale } from '../../../../session/db.js';

export type ComponentRationalePanelProps = {
  data: ComponentRationale;
  scrollOffset: number;
  width: number;
  height: number;
  active: boolean;
};

const PLACEHOLDER = '(no rationale captured)';

/**
 * Word-wrap a paragraph to fit `innerWidth` columns. Mirrors the helper in
 * RationalePanel.tsx so wrapping is identical across both panels.
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
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; dim?: boolean }
  | { kind: 'list-name'; text: string; sublabel?: string }
  | { kind: 'blank' };

/**
 * Flatten the component rationale into a list of rendered lines so scrollOffset
 * slicing matches what the operator sees.
 */
export function renderComponentRationaleLines(data: ComponentRationale, innerWidth: number): RenderedLine[] {
  const out: RenderedLine[] = [];

  const pushSection = (heading: string, body: string | null) => {
    out.push({ kind: 'heading', text: heading });
    const text = body && body.trim().length > 0 ? body : PLACEHOLDER;
    for (const ln of wrapText(text, Math.max(1, innerWidth - 2))) {
      out.push({ kind: 'text', text: '  ' + ln, dim: !body });
    }
    out.push({ kind: 'blank' });
  };

  // "Description" section shows the human-facing component description.
  // The `descriptionRationale` (WHY the component was classified this way)
  // is appended as a small "why" line so the operator can see the LLM's
  // reasoning without leaving the panel.
  out.push({ kind: 'heading', text: 'Description' });
  const descBody = data.description && data.description.trim().length > 0 ? data.description : PLACEHOLDER;
  for (const ln of wrapText(descBody, Math.max(1, innerWidth - 2))) {
    out.push({ kind: 'text', text: '  ' + ln, dim: !data.description });
  }
  if (data.descriptionRationale && data.descriptionRationale.trim().length > 0) {
    for (const ln of wrapText(`why: ${data.descriptionRationale}`, Math.max(1, innerWidth - 2))) {
      out.push({ kind: 'text', text: '  ' + ln, dim: true });
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
      out.push({ kind: 'list-name', text: p.name, sublabel: sub });
      const text = p.rationale && p.rationale.trim().length > 0 ? p.rationale : PLACEHOLDER;
      for (const ln of wrapText(text, Math.max(1, innerWidth - 4))) {
        out.push({ kind: 'text', text: '    ' + ln, dim: !p.rationale });
      }
    }
  }
  out.push({ kind: 'blank' });

  out.push({ kind: 'heading', text: 'Slots' });
  if (data.slots.length === 0) {
    out.push({ kind: 'text', text: '  ' + PLACEHOLDER, dim: true });
  } else {
    for (const s of data.slots) {
      out.push({ kind: 'list-name', text: s.name });
      const text = s.rationale && s.rationale.trim().length > 0 ? s.rationale : PLACEHOLDER;
      for (const ln of wrapText(text, Math.max(1, innerWidth - 4))) {
        out.push({ kind: 'text', text: '    ' + ln, dim: !s.rationale });
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
  // Reserve one line at the bottom for the legend.
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
      {visible.map((line, i) => {
        if (line.kind === 'blank') {
          return (
            <Box key={i}>
              <Text> </Text>
            </Box>
          );
        }
        if (line.kind === 'heading') {
          return (
            <Box key={i}>
              <Text bold color={PALETTE.info} dimColor={!active}>
                {line.text}
              </Text>
            </Box>
          );
        }
        if (line.kind === 'list-name') {
          return (
            <Box key={i}>
              <Text>{'  - '}</Text>
              <Text bold dimColor={!active}>
                {line.text}
              </Text>
              {line.sublabel ? <Text dimColor>{' ' + line.sublabel}</Text> : null}
            </Box>
          );
        }
        return (
          <Box key={i}>
            <Text dimColor={!active || line.dim}>{line.text}</Text>
          </Box>
        );
      })}
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
