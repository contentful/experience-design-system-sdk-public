import React from 'react';
import { Box, Text } from 'ink';
import figures from 'figures';
import { computeColumnWindow, sideColumnLabelStyle, type AddedComponentEntry } from '../columns.js';
import { PALETTE } from '../sidebar/theme.js';
import { WindowIndicator, WindowedPanel } from '../sidebar/components/windowed-panel.js';

interface AddedColumnProps {
  title: string;
  width: number;
  height: number;
  entries: AddedComponentEntry[];
  cursor: number;
  focused: boolean;
  aiFlaggedByKey?: Map<string, boolean>;
  visibleCount: number;
}

/** The accepted components, cycle members first. Rejecting from here is the only decision it allows. */
export function AddedColumn(props: AddedColumnProps): React.ReactElement {
  const { title, width, height, entries, cursor, focused, aiFlaggedByKey, visibleCount } = props;
  const reserveAiBadge = entries.some((e) => aiFlaggedByKey?.get(e.name) === true);
  const firstNonCycleIdx = entries.findIndex((e) => !e.isCycle);
  const window = computeColumnWindow(entries.length, cursor, Math.max(1, visibleCount));
  return (
    <WindowedPanel width={width} height={height} title={title} focused={focused}>
      <WindowIndicator direction="up" count={window.above} />
      {entries.length === 0 ? (
        <Text color={PALETTE.muted}>(none)</Text>
      ) : (
        entries.slice(window.start, window.end).map((entry, vi) => {
          const i = window.start + vi;
          const isSelected = i === cursor;
          const isCursor = focused && isSelected;
          const aiFlagged = aiFlaggedByKey?.get(entry.name) === true;
          const showSeparator = firstNonCycleIdx > 0 && i === firstNonCycleIdx;
          const style = sideColumnLabelStyle({ isCycle: entry.isCycle, isSelected, focused });
          return (
            <React.Fragment key={entry.name}>
              {showSeparator && <Text color={PALETTE.muted}>{'─'.repeat(Math.max(0, width - 2))}</Text>}
              <Box>
                {isCursor ? (
                  <Text color={PALETTE.info} bold>
                    {figures.pointer}
                  </Text>
                ) : (
                  <Text> </Text>
                )}
                {reserveAiBadge &&
                  (aiFlagged ? (
                    <Text color={PALETTE.warning} bold>
                      {' [×]'}
                    </Text>
                  ) : (
                    <Text>{'    '}</Text>
                  ))}
                {entry.isCycle && (
                  <Text color={isCursor ? PALETTE.info : PALETTE.warning} bold underline={style.nameUnderline}>
                    {' ⚠'}
                  </Text>
                )}
                <Text
                  color={style.nameColor}
                  bold={style.nameBold}
                  inverse={style.nameInverse}
                  underline={style.nameUnderline}
                  wrap="wrap"
                >
                  {' ' + entry.name}
                </Text>
              </Box>
            </React.Fragment>
          );
        })
      )}
      <WindowIndicator direction="down" count={window.below} />
    </WindowedPanel>
  );
}
