import React from 'react';
import { Box, Text } from 'ink';

type ScrollablePanelProps = {
  header: React.ReactNode;
  width: number;
  height: number;
  active: boolean;
  totalLines: number;
  visibleStart: number;
  visibleEnd: number;
  borderColor?: string;
  children: React.ReactNode;
};

export function ScrollablePanel({
  header,
  width,
  height,
  active,
  totalLines,
  visibleStart,
  visibleEnd,
  borderColor,
  children,
}: ScrollablePanelProps): React.ReactElement {
  const overflowed = totalLines > height;

  return (
    <Box flexDirection="column" width={width} height={height + 2} borderStyle="single" borderColor={borderColor}>
      <Box>
        {header}
        {overflowed && (
          <>
            <Box flexGrow={1} />
            <Text dimColor={!active}>{`↕ ${visibleStart}-${visibleEnd}/${totalLines}`}</Text>
          </>
        )}
      </Box>
      {children}
    </Box>
  );
}
