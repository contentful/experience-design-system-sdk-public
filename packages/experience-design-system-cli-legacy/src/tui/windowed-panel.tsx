import { Box, Text, type BoxProps } from 'ink';
import type { ReactElement, ReactNode } from 'react';
import { PALETTE } from '../analyze/select/tui/theme.js';

export type WindowDirection = 'up' | 'down';

const MIN_TERMINAL_PANEL_HEIGHT = 5;

/** Size a standalone panel to the terminal while reserving a small safety margin. */
export function terminalPanelHeight(rows: number, reservedRows = 4): number {
  return Math.max(MIN_TERMINAL_PANEL_HEIGHT, rows - reservedRows);
}

export interface WindowedPanelProps {
  width: number;
  height?: number;
  title?: string;
  focused: boolean;
  children: ReactNode;
}

export interface FixedPanelProps {
  width: number;
  height?: number;
  minHeight?: BoxProps['minHeight'];
  focused?: boolean;
  borderStyle?: BoxProps['borderStyle'];
  borderColor?: BoxProps['borderColor'];
  paddingLeft?: BoxProps['paddingLeft'];
  clipOverflow?: boolean;
  children: ReactNode;
}

/** Shared panel frame that clips content instead of resizing its layout slot. */
export function FixedPanel({
  width,
  height,
  minHeight,
  focused = false,
  borderStyle,
  borderColor,
  paddingLeft,
  clipOverflow = true,
  children,
}: FixedPanelProps): ReactElement {
  return (
    <Box
      flexDirection="column"
      width={width}
      {...(height === undefined ? {} : { height })}
      {...(minHeight === undefined ? {} : { minHeight })}
      {...(height === undefined || !clipOverflow ? {} : { overflowY: 'hidden' as const })}
      flexShrink={0}
      borderStyle={borderStyle}
      borderColor={focused ? (borderColor ?? 'white') : borderColor}
      paddingLeft={paddingLeft}
    >
      {children}
    </Box>
  );
}

/** Shared frame for panels whose viewport must not change with their contents. */
export function WindowedPanel({ width, height, title, focused, children }: WindowedPanelProps): ReactElement {
  return (
    <FixedPanel
      width={width}
      borderStyle="single"
      borderColor={focused ? 'white' : undefined}
      {...(height === undefined ? {} : { height })}
      focused={focused}
    >
      {title && <WindowedPanelHeader title={title} width={width} focused={focused} />}
      {children}
    </FixedPanel>
  );
}

export function WindowedPanelHeader({
  title,
  width,
  focused,
}: {
  title: string;
  width: number;
  focused: boolean;
}): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color={PALETTE.info} inverse={focused}>
        {title}
      </Text>
      <Text dimColor>{'─'.repeat(Math.max(0, width - 2))}</Text>
    </Box>
  );
}

export function formatWindowIndicator(direction: WindowDirection, count: number): string {
  if (count <= 0) return ' ';
  return `${direction === 'up' ? '↑' : '↓'} ${count} more`;
}

export function WindowIndicator({ direction, count }: { direction: WindowDirection; count: number }): ReactElement {
  return <Text color={PALETTE.muted}>{formatWindowIndicator(direction, count)}</Text>;
}
