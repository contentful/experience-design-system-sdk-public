import { Box, Text } from 'ink';
import React from 'react';

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
  const labelAcc = condensed ? 'Acc' : 'Accepted';
  const labelGrp = condensed ? 'Grp' : 'Groups';
  const labelRej = condensed ? 'Rej' : 'Rejected';
  const labelUnd = condensed ? 'Und' : 'Undecided';
  const sep = condensed ? ' | ' : '    ';
  return (
    <Box marginTop={1}>
      <Text>
        <Text dimColor>{labelAcc} </Text>
        <Text bold>{counters.accepted}</Text>
        <Text dimColor>{`/${counters.total}`}</Text>
        <Text dimColor>{sep}</Text>
        <Text dimColor>{labelGrp} </Text>
        <Text bold>{counters.groups}</Text>
        <Text dimColor>{sep}</Text>
        <Text dimColor>{labelRej} </Text>
        <Text bold>{counters.rejected}</Text>
        <Text dimColor>{sep}</Text>
        <Text dimColor>{labelUnd} </Text>
        <Text bold>{counters.undecided}</Text>
      </Text>
    </Box>
  );
}
