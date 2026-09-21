import React from 'react';
import { Box, Text } from 'ink';
import { HighlightedLine, type HighlightPart } from './HighlightedLine.js';
import { ScrollablePanel } from './ScrollablePanel.js';

type JsonPanelProps = {
  label: string;
  value: string;
  scrollOffset: number;
  width: number;
  height: number;
  active: boolean;
};

function highlightJson(line: string): React.ReactElement {
  // Simple regex-based syntax highlighting
  const parts: HighlightPart[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    // Object key: "key":
    const keyMatch = remaining.match(/^("(?:[^"\\]|\\.)*"\s*:)/);
    if (keyMatch) {
      parts.push({ text: keyMatch[1], color: 'cyan' });
      remaining = remaining.slice(keyMatch[1].length);
      continue;
    }

    // String value
    const strMatch = remaining.match(/^("(?:[^"\\]|\\.)*")/);
    if (strMatch) {
      parts.push({ text: strMatch[1], color: 'green' });
      remaining = remaining.slice(strMatch[1].length);
      continue;
    }

    // Number
    const numMatch = remaining.match(/^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (numMatch) {
      parts.push({ text: numMatch[1], color: 'yellow' });
      remaining = remaining.slice(numMatch[1].length);
      continue;
    }

    // Boolean
    const boolMatch = remaining.match(/^(true|false)/);
    if (boolMatch) {
      parts.push({ text: boolMatch[1], color: 'magenta' });
      remaining = remaining.slice(boolMatch[1].length);
      continue;
    }

    // Null
    const nullMatch = remaining.match(/^(null)/);
    if (nullMatch) {
      parts.push({ text: nullMatch[1], color: 'red', dim: true });
      remaining = remaining.slice(nullMatch[1].length);
      continue;
    }

    // Take one character as-is (punctuation, whitespace, etc.)
    parts.push({ text: remaining[0] });
    remaining = remaining.slice(1);
  }

  return <HighlightedLine parts={parts} />;
}

function truncateLine(line: string, maxWidth: number): string {
  if (line.length <= maxWidth) return line;
  return line.slice(0, maxWidth - 1) + '…';
}

export function JsonPanel({ label, value, scrollOffset, width, height, active }: JsonPanelProps): React.ReactElement {
  const allLines = value.split('\n');
  const visibleLines = allLines.slice(scrollOffset, scrollOffset + height);
  const innerWidth = Math.max(1, width - 2); // subtract border
  const totalLines = allLines.length;
  const visibleStart = totalLines === 0 ? 0 : scrollOffset + 1;
  const visibleEnd = Math.min(totalLines, scrollOffset + height);

  return (
    <ScrollablePanel
      header={
        <Text bold dimColor={!active}>
          {label}
        </Text>
      }
      width={width}
      height={height}
      active={active}
      totalLines={totalLines}
      visibleStart={visibleStart}
      visibleEnd={visibleEnd}
      borderColor={active ? 'white' : undefined}
    >
      {visibleLines.map((line, i) => {
        const truncated = truncateLine(line, innerWidth);
        return <Box key={i}>{highlightJson(truncated)}</Box>;
      })}
    </ScrollablePanel>
  );
}
