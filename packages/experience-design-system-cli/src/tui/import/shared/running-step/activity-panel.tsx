import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { PALETTE } from '@tui/theme.js';
import { useTerminalWidth } from '@tui/use-terminal-width.js';
import { formatDuration } from './logic.js';
import { PANEL_COLUMNS, panelLayout, truncate, visibleActivity, type ActivityItem } from './activity.js';

// How many entries the panel shows at once. A failure's reason takes a line of its own.
const MAX_ROWS = 8;

const ICON = { done: '✓', failed: '✗' } as const;
const COLOR = { done: PALETTE.success, failed: PALETTE.error } as const;

function Row({ item, width }: { item: ActivityItem; width: number }): React.ReactElement {
  const time = item.ms !== undefined ? formatDuration(item.ms) : '';
  const note = item.detail ? ` ${item.detail}` : '';
  // The icon and its gap take two columns, the time and its gap up to eight.
  const name = truncate(`${item.name}${note}`, Math.max(8, width - 12));
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {item.state === 'running' ? <Spinner /> : <Text color={COLOR[item.state]}>{ICON[item.state]}</Text>}
        <Text color={item.state === 'failed' ? PALETTE.error : PALETTE.muted}>{name}</Text>
        {time && <Text color={PALETTE.muted}>{time}</Text>}
      </Box>
      {item.state === 'failed' && item.error && (
        <Text color={PALETTE.error}>{`  ${truncate(item.error, Math.max(12, width - 6))}`}</Text>
      )}
    </Box>
  );
}

/** A rolling log of what a long step has done, beside it on a wide terminal and under it on a narrow one. */
export function ActivityPanel({ title, items }: { title: string; items: readonly ActivityItem[] }): React.ReactElement {
  const columns = useTerminalWidth();
  const width = panelLayout(columns) === 'beside' ? PANEL_COLUMNS : Math.max(30, columns - 4);
  const { shown, hidden } = visibleActivity(items, MAX_ROWS);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.muted} paddingX={1} width={width}>
      <Text bold>{title}</Text>
      {shown.map((item, index) => (
        <Row key={`${index}-${item.name}`} item={item} width={width} />
      ))}
      {hidden > 0 && <Text color={PALETTE.muted}>{`+ ${hidden} more`}</Text>}
    </Box>
  );
}

/**
 * Lays out a step with its panel: the panel goes beside the step on a wide terminal and under it on a narrow one. A step
 * with no panel is returned exactly as it is.
 */
export function AsideLayout({
  aside,
  children,
}: {
  aside?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const columns = useTerminalWidth();
  if (!aside) return <>{children}</>;
  const beside = panelLayout(columns) === 'beside';
  return (
    <Box flexDirection={beside ? 'row' : 'column'} alignItems="flex-start">
      {children}
      <Box paddingX={beside ? 0 : 2} paddingBottom={1}>
        {aside}
      </Box>
    </Box>
  );
}
