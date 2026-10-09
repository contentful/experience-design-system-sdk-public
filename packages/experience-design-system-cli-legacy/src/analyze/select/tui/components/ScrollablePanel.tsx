import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../theme.js';

type ScrollablePanelProps = {
  title: string;
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
  title,
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
        <Text bold color={active ? undefined : PALETTE.muted}>
          {title}
        </Text>
        {overflowed && (
          <>
            <Box flexGrow={1} />
            <Text color={active ? undefined : PALETTE.muted}>{`↕ ${visibleStart}-${visibleEnd}/${totalLines}`}</Text>
          </>
        )}
      </Box>
      {children}
    </Box>
  );
}
