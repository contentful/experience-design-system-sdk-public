import { Box, Text } from 'ink';
import { PALETTE } from '../../analyze/select/tui/theme.js';
import React from 'react';
import { ScopeGateStep } from './steps/ScopeGateStep.js';
import { AtomicScopeGateStep } from './steps/AtomicScopeGateStep.js';
import type { ScopeComponent } from './steps/ScopeGateStep.js';
import type { CompositionMode } from '../../lib/composition-mode.js';

export type { ScopeComponent };

export type AutoFilterStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';

export type ScopeGateHostProps = {
  components: ReadonlyArray<ScopeComponent>;
  autoAccept: boolean;
  compositionMode?: CompositionMode;
  onConfirm: (decisions: { accepted: string[]; rejected: string[] }) => void;
  onQuit: () => void;
  aiFilterStatus?: AutoFilterStatus;
  aiFilterProgress?: { done: number; total: number } | null;
  aiFilterError?: string | null;
  onCancelAutoFilter?: () => void;
};

export function ScopeGateHost({
  components,
  autoAccept,
  compositionMode = 'atomic',
  onConfirm,
  onQuit,
  aiFilterStatus = 'idle',
  aiFilterProgress = null,
  aiFilterError = null,
  onCancelAutoFilter,
}: ScopeGateHostProps): React.ReactElement {
  if (components.length === 0) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color={PALETTE.error}>Error: no components found for this session — please re-run analyze extract.</Text>
      </Box>
    );
  }

  if (autoAccept) {
    return <ScopeGateAutoAccept components={components} onConfirm={onConfirm} />;
  }

  // Atomic mode (spec T9): render the pre-composite flat step. It never imports
  // the graph/closures/cycles/cascade primitives, so this host fork is the
  // single point where "atomic bypasses the graph" is guaranteed on the
  // interactive path.
  if (compositionMode === 'atomic') {
    return (
      <AtomicScopeGateStep
        components={[...components]}
        onConfirm={onConfirm}
        onQuit={onQuit}
        aiFilterStatus={aiFilterStatus}
        aiFilterProgress={aiFilterProgress}
        aiFilterError={aiFilterError}
        onCancelAutoFilter={onCancelAutoFilter}
      />
    );
  }

  return (
    <ScopeGateStep
      components={[...components]}
      onConfirm={onConfirm}
      onQuit={onQuit}
      aiFilterStatus={aiFilterStatus}
      aiFilterProgress={aiFilterProgress}
      aiFilterError={aiFilterError}
      onCancelAutoFilter={onCancelAutoFilter}
    />
  );
}

function ScopeGateAutoAccept({
  components,
  onConfirm,
}: {
  components: ReadonlyArray<ScopeComponent>;
  onConfirm: (decisions: { accepted: string[]; rejected: string[] }) => void;
}): React.ReactElement {
  React.useEffect(() => {
    onConfirm({ accepted: components.map((c) => c.name), rejected: [] });
  }, []);
  return (
    <Box paddingX={2} paddingY={1}>
      <Text dimColor>Auto-accepting {components.length} components...</Text>
    </Box>
  );
}
