import React from 'react';
import { Box, Text } from 'ink';
import type {
  LineageEntry,
  LineageJumpable,
} from '../../../../import/tui/hooks/useLineage.js';

export interface LineagePanelProps {
  focusedComponentKey: string;
  entries: LineageEntry[];
  /** Index into the jumpables list — NOT into entries. */
  cursor: number;
  jumpables: LineageJumpable[];
}

/**
 * Display-only lineage panel — open/close state stays with the parent step.
 * Rendering copied verbatim from ScopeGateStep's inline
 * `lineagePanelOpen && focusedComponent && (…)` block so both callsites
 * (ScopeGate + GenerateReview) share pixel-identical output.
 */
export function LineagePanel({
  focusedComponentKey,
  entries,
  cursor,
  jumpables,
}: LineagePanelProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text bold>{`Lineage: ${focusedComponentKey}`}</Text>
      {entries.map((e, i) => {
        const jumpableIdx = jumpables.findIndex((j) => j.i === i);
        const isCursor = jumpableIdx === cursor && jumpableIdx >= 0;
        if (e.kind === 'section') {
          return (
            <Text key={i} bold>
              {'  '}
              {e.label}
            </Text>
          );
        }
        if (e.kind === 'empty') {
          return (
            <Text key={i}>
              <Text> </Text>
              <Text dimColor>{' ' + e.label}</Text>
            </Text>
          );
        }
        return (
          <Text key={i}>
            {isCursor ? (
              <Text color="cyan" bold>
                {'▶'}
              </Text>
            ) : (
              <Text> </Text>
            )}
            <Text inverse={isCursor}>{' ' + e.label}</Text>
          </Text>
        );
      })}
      <Text dimColor>[↑/↓] move · [Enter] jump · [l/Esc] close</Text>
    </Box>
  );
}
