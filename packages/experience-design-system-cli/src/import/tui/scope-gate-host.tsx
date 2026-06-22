import { Box, Text } from 'ink';
import React from 'react';
import { ScopeGateStep } from './steps/ScopeGateStep.js';
import type { ScopeComponent } from './steps/ScopeGateStep.js';

export type { ScopeComponent };

export type ScopeGateHostProps = {
  components: ReadonlyArray<ScopeComponent>;
  autoAccept: boolean;
  onConfirm: (decisions: { accepted: string[]; rejected: string[] }) => void;
  onQuit: () => void;
};

export function ScopeGateHost({
  components,
  autoAccept,
  onConfirm,
  onQuit,
}: ScopeGateHostProps): React.ReactElement {
  if (components.length === 0) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color="red">Error: no components found for this session — please re-run analyze extract.</Text>
      </Box>
    );
  }

  if (autoAccept) {
    return <ScopeGateAutoAccept components={components} onConfirm={onConfirm} />;
  }

  return <ScopeGateStep components={[...components]} onConfirm={onConfirm} onQuit={onQuit} />;
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
    // fire once on mount; deps intentionally empty so a re-render with new components doesn't double-confirm
  }, []);
  return (
    <Box paddingX={2} paddingY={1}>
      <Text dimColor>Auto-accepting {components.length} components...</Text>
    </Box>
  );
}
