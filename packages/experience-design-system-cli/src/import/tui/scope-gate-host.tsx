import { Box, Text } from 'ink';
import { PALETTE } from '../../analyze/select/tui/theme.js';
import React from 'react';
import { ScopeGateStep } from './steps/ScopeGateStep.js';
import { AtomicScopeGateStep } from './steps/AtomicScopeGateStep.js';
import type { ScopeComponent } from './steps/ScopeGateStep.js';
import type { CompositionMode } from '../../lib/composition-mode.js';

export type { ScopeComponent };

export type ScopeGateHostProps = {
  components: ReadonlyArray<ScopeComponent>;
  compositionMode?: CompositionMode;
  onConfirm: (decisions: { accepted: string[]; rejected: string[] }) => void;
  onQuit: () => void;
  /** Retained for fixture compatibility; filtering is no longer performed here. */
  aiFilterStatus?: string;
  aiFilterProgress?: { done: number; total: number } | null;
  aiFilterError?: string | null;
};

export function ScopeGateHost({
  components,
  compositionMode = 'atomic',
  onConfirm,
  onQuit,
}: ScopeGateHostProps): React.ReactElement {
  if (components.length === 0) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color={PALETTE.error}>Error: no components found for this session — please re-run analyze extract.</Text>
      </Box>
    );
  }

  // Atomic mode (spec T9): render the pre-composite flat step. It never imports
  // the graph/closures/cycles/cascade primitives, so this host fork is the
  // single point where "atomic bypasses the graph" is guaranteed on the
  // interactive path.
  if (compositionMode === 'atomic') {
    return <AtomicScopeGateStep components={[...components]} onConfirm={onConfirm} onQuit={onQuit} />;
  }

  return <ScopeGateStep components={[...components]} onConfirm={onConfirm} onQuit={onQuit} />;
}
