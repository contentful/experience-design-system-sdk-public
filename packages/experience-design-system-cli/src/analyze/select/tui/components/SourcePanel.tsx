import React from 'react';
import { Box, Text } from 'ink';

type SourcePanelProps = {
  sourceCode: string | null;
  filePath: string;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
};

const KEYWORDS =
  /\b(function|export|const|let|import|return|interface|type|default|class|extends|implements|from|async|await)\b/;

function highlightSourceLine(line: string): React.ReactElement {
  const parts: Array<{ text: string; color?: string }> = [];
  let remaining = line;

  while (remaining.length > 0) {
    // String literal
    const strMatch = remaining.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/);
    if (strMatch) {
      parts.push({ text: strMatch[1], color: 'green' });
      remaining = remaining.slice(strMatch[1].length);
      continue;
    }

    // Keyword
    const kwMatch = remaining.match(KEYWORDS);
    if (kwMatch && kwMatch.index === 0) {
      parts.push({ text: kwMatch[0], color: 'cyan' });
      remaining = remaining.slice(kwMatch[0].length);
      continue;
    }

    parts.push({ text: remaining[0] });
    remaining = remaining.slice(1);
  }

  return (
    <>
      {parts.map((part, i) => (
        <Text key={i} color={part.color}>
          {part.text}
        </Text>
      ))}
    </>
  );
}

function truncateFilePath(filePath: string, maxWidth: number): string {
  if (filePath.length <= maxWidth) return filePath;
  const filename = filePath.split('/').pop() ?? filePath;
  if (filename.length >= maxWidth) return filename.slice(0, maxWidth - 1) + '…';
  return '…' + filePath.slice(filePath.length - (maxWidth - 1));
}

export function SourcePanel({
  sourceCode,
  filePath,
  width,
  height,
  scrollX,
  scrollY,
}: SourcePanelProps): React.ReactElement {
  const innerWidth = Math.max(1, width - 2);
  const header = truncateFilePath(filePath, innerWidth);

  if (!sourceCode) {
    return (
      <Box flexDirection="column" width={width} height={height + 2} borderStyle="single">
        <Text dimColor>{header}</Text>
        <Box justifyContent="center" alignItems="center" height={height}>
          <Text dimColor>[No source available]</Text>
        </Box>
      </Box>
    );
  }

  const allLines = sourceCode.split('\n');
  const visibleLines = allLines.slice(scrollY, scrollY + height);
  const showScrollUp = scrollY > 0;
  const showScrollDown = scrollY + height < allLines.length;
  const maxLineWidth = Math.max(...visibleLines.map((l) => l.length));
  const showScrollLeft = scrollX > 0;
  const showScrollRight = scrollX + innerWidth < maxLineWidth;

  return (
    <Box flexDirection="column" width={width} height={height + 2} borderStyle="single">
      <Box justifyContent="space-between">
        <Text dimColor>{header}</Text>
        <Text dimColor>
          {showScrollUp ? '▲' : ' '}
          {showScrollDown ? '▼' : ' '}
          {showScrollLeft ? '◀' : ' '}
          {showScrollRight ? '▶' : ' '}
        </Text>
      </Box>
      {visibleLines.map((line, i) => {
        const sliced = line.slice(scrollX, scrollX + innerWidth);
        return <Box key={i}>{highlightSourceLine(sliced)}</Box>;
      })}
    </Box>
  );
}
