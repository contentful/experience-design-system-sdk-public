import { Box, Text } from 'ink';
import React from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';

export type CounterStripCounters = {
  accepted: number;
  rejected: number;
  undecided: number;
  groups: number;
  total: number;
};

export function CounterStrip(props: { counters: CounterStripCounters; totalWidth: number }): React.ReactElement {
  const { counters, totalWidth } = props;
  const condensed = totalWidth < 60;
  const labelGrp = condensed ? 'Cmp' : 'Components with Slots';
  const labelRej = condensed ? 'Rej' : 'Rejected';
  const labelUnd = condensed ? 'Und' : 'Undecided';
  const sep = condensed ? ' | ' : '    ';
  return (
    <Box>
      <Text>
        <Text color={PALETTE.muted}>{labelGrp} </Text>
        <Text bold>{counters.groups}</Text>
        <Text color={PALETTE.muted}>{sep}</Text>
        <Text color={PALETTE.muted}>{labelRej} </Text>
        <Text bold>{counters.rejected}</Text>
        <Text color={PALETTE.muted}>{sep}</Text>
        <Text color={PALETTE.muted}>{labelUnd} </Text>
        <Text bold>{counters.undecided}</Text>
        <Text color={PALETTE.muted}>{sep}</Text>
      </Text>
    </Box>
  );
}
