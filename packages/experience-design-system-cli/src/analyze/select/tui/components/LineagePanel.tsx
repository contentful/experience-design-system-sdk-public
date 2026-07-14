import React from 'react';
import { PALETTE } from '../theme.js';
import { Text } from 'ink';
import type {
  LineageEntry,
  LineageJumpable,
} from '../../../../import/tui/hooks/useLineage.js';
import { GotoBanner, type GotoRow } from './GotoBanner.js';

export interface LineagePanelProps {
  focusedComponentKey: string;
  entries: LineageEntry[];
  /** Index into the jumpables list — NOT into entries. */
  cursor: number;
  jumpables: LineageJumpable[];
  /** Max entry rows rendered at once. Larger lineages window around the cursor. */
  maxRows?: number;
  /** Constrain the panel box to a fixed column width (e.g. the sidebar slot). */
  width?: number;
}

const LINEAGE_FOOTER_HINT = '[↑/↓] move · [Enter] jump · [l/Esc] close';

export function LineagePanel({
  focusedComponentKey,
  entries,
  cursor,
  jumpables,
  maxRows,
  width,
}: LineagePanelProps): React.ReactElement {
  const rows: GotoRow[] = entries.map((e) => ({
    label: e.label,
    jumpTarget: e.kind === 'ancestor' || e.kind === 'descendant' ? e.jumpTarget : '',
    kind: e.kind,
  }));
  const cursorRowIndex = jumpables[cursor]?.i ?? 0;

  return (
    <GotoBanner
      title={`Lineage: ${focusedComponentKey}`}
      rows={rows}
      cursor={cursor}
      cursorRowIndex={cursorRowIndex}
      maxRows={maxRows}
      width={width}
      footerHint={LINEAGE_FOOTER_HINT}
      renderRow={(row, i, isCursor) => {
        if (row.kind === 'section') {
          return (
            <Text key={i} bold>
              {'  '}
              {row.label}
            </Text>
          );
        }
        if (row.kind === 'empty') {
          return (
            <Text key={i}>
              <Text> </Text>
              <Text dimColor>{' ' + row.label}</Text>
            </Text>
          );
        }
        return (
          <Text key={i}>
            {isCursor ? (
              <Text color={PALETTE.info} bold>
                {'▶'}
              </Text>
            ) : (
              <Text> </Text>
            )}
            <Text inverse={isCursor}>{' ' + row.label}</Text>
          </Text>
        );
      }}
    />
  );
}
