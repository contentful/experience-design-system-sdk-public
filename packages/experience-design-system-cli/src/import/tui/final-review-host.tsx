import { Box, Text } from 'ink';
import { PALETTE } from '../../analyze/select/tui/theme.js';
import React from 'react';
import { GenerateReviewStep } from './steps/GenerateReviewStep.js';
import { AtomicGenerateReviewStep } from './steps/AtomicGenerateReviewStep.js';
import type { CompositionMode } from '../../lib/composition-mode.js';

export type FinalReviewHostProps = {
  extractSessionId: string | null;
  generatedCount: number;
  autoAccept: boolean;
  compositionMode?: CompositionMode;
  onFinalize: (accepted: number, rejected: number, unresolved: number) => void;
  onQuit: () => void;
  livePreview?: boolean;
  spaceId?: string;
  environmentId?: string;
  cmaToken?: string;
  host?: string;
  tokensPath?: string;
  initialFinalizeError?: string | null;
};

export function FinalReviewHost({
  extractSessionId,
  generatedCount,
  autoAccept,
  compositionMode = 'atomic',
  onFinalize,
  onQuit,
  livePreview,
  spaceId,
  environmentId,
  cmaToken,
  host,
  tokensPath,
  initialFinalizeError,
}: FinalReviewHostProps): React.ReactElement {
  if (!extractSessionId) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color={PALETTE.error}>Error: no session ID — cannot load generated definitions.</Text>
      </Box>
    );
  }

  if (autoAccept) {
    return <FinalReviewAutoAccept generatedCount={generatedCount} onFinalize={onFinalize} />;
  }

  // Atomic mode (spec T9): render the pre-composite flat review step. It never
  // passes projectSlotGraph to FieldEditor and never walks closures/cycles, so
  // slot-composition editing and every hierarchy affordance stay absent.
  const StepComponent = compositionMode === 'atomic' ? AtomicGenerateReviewStep : GenerateReviewStep;

  return (
    <StepComponent
      extractSessionId={extractSessionId}
      onFinalize={onFinalize}
      onQuit={onQuit}
      livePreview={livePreview}
      spaceId={spaceId}
      environmentId={environmentId}
      cmaToken={cmaToken}
      host={host}
      tokensPath={tokensPath}
      initialFinalizeError={initialFinalizeError}
    />
  );
}

function FinalReviewAutoAccept({
  generatedCount,
  onFinalize,
}: {
  generatedCount: number;
  onFinalize: (accepted: number, rejected: number, unresolved: number) => void;
}): React.ReactElement {
  React.useEffect(() => {
    onFinalize(generatedCount, 0, 0);
  }, []);
  return (
    <Box paddingX={2} paddingY={1}>
      <Text dimColor>Auto-accepting {generatedCount} generated components...</Text>
    </Box>
  );
}
