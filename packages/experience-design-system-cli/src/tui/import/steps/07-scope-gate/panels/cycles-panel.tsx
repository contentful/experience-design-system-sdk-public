import React from 'react';
import { Box, Text } from 'ink';
import figures from 'figures';
import type { SlotCycle } from '../graph/cycle-detection.js';
import { PALETTE } from '@tui/theme.js';

interface CyclesPanelProps {
  cycles: SlotCycle[];
  cursor: number;
}

function cycleLabel(cycle: SlotCycle, index: number): string {
  const parts: string[] = [];
  for (let i = 0; i < cycle.edges.length; i++) {
    parts.push(cycle.path[i]);
    parts.push(`[${cycle.edges[i].slotName}]`);
  }
  parts.push(cycle.path[cycle.path.length - 1]);
  return `Cycle ${index + 1}: ${parts.join(' → ')}`;
}

export function CyclesPanel({ cycles, cursor }: CyclesPanelProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={PALETTE.warning} paddingX={1} marginTop={1}>
      <Text bold color={PALETTE.warning}>{`Cycles detected (${cycles.length}):`}</Text>
      <Text> </Text>
      {cycles.map((cycle, i) => {
        const isCursor = i === cursor;
        return (
          <Text key={i}>
            {isCursor ? (
              <Text color={PALETTE.accent} bold>
                {figures.pointer}
              </Text>
            ) : (
              <Text> </Text>
            )}
            <Text color={PALETTE.warning} inverse={isCursor}>
              {' ' + cycleLabel(cycle, i)}
            </Text>
          </Text>
        );
      })}
      <Text>[↑/↓] move · [Enter] jump · [c/Esc] close</Text>
    </Box>
  );
}
