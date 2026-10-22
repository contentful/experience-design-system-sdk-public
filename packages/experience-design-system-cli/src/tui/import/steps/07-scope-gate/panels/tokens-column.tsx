import React from 'react';
import { Box, Text } from 'ink';
import figures from 'figures';
import { PALETTE } from '@tui/theme.js';
import { computeColumnWindow, longestEntries, type TokenRow } from '../../05-token-review/logic.js';
import { WindowIndicator, WindowedPanel } from '../sidebar/components/windowed-panel.js';

interface TokensColumnProps {
  title: string;
  width: number;
  height: number;
  tokens: readonly TokenRow[];
  cursor: number;
  focused: boolean;
  visibleCount: number;
}

/** The design tokens that will be imported with the components. Read only: scrolling is all it allows. */
export function TokensColumn(props: TokensColumnProps): React.ReactElement {
  const { title, width, height, tokens, cursor, focused, visibleCount } = props;
  // Names are padded to the longest so the values line up; the panel's border, cursor and padding take the rest.
  const nameWidth = Math.min(longestEntries(tokens).path + 2, Math.floor((width - 8) / 2));
  const window = computeColumnWindow(tokens.length, cursor, Math.max(1, visibleCount));
  return (
    <WindowedPanel width={width} height={height} title={title} focused={focused}>
      <WindowIndicator direction="up" count={window.above} />
      {tokens.slice(window.start, window.end).map((token, offset) => {
        const isCursor = focused && window.start + offset === cursor;
        return (
          <Box key={token.path}>
            <Text color={PALETTE.accent} bold>
              {isCursor ? figures.pointer : ' '}
            </Text>
            <Text wrap="truncate-end" color={isCursor ? PALETTE.accent : undefined} bold={isCursor}>
              {` ${token.path.padEnd(nameWidth)}`}
              <Text color={PALETTE.muted}>{token.value}</Text>
            </Text>
          </Box>
        );
      })}
      <WindowIndicator direction="down" count={window.below} />
    </WindowedPanel>
  );
}
