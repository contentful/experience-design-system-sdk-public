import { Box, Text } from 'ink';
import type { ReactElement, ReactNode } from 'react';
import { PALETTE } from '../analyze/select/tui/theme.js';

export type WindowDirection = 'up' | 'down';

export interface WindowedPanelProps {
  width: number;
  height?: number;
  title?: string;
  focused: boolean;
  children: ReactNode;
}

/** Shared frame for panels whose viewport must not change with their contents. */
export function WindowedPanel({ width, height, title, focused, children }: WindowedPanelProps): ReactElement {
  return (
    <Box
      flexDirection="column"
      width={width}
      {...(height === undefined ? {} : { height, overflowY: 'hidden' as const })}
      flexShrink={0}
      borderStyle="single"
      borderColor={focused ? 'white' : undefined}
    >
      {title && <WindowedPanelHeader title={title} width={width} focused={focused} />}
      {children}
    </Box>
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
  return <Text dimColor>{formatWindowIndicator(direction, count)}</Text>;
}
