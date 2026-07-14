import { Box, Text } from 'ink';
import { PALETTE } from '../../analyze/select/tui/theme.js';
import React from 'react';
import { GenerateReviewStep } from './steps/GenerateReviewStep.js';

export type FinalReviewHostProps = {
  extractSessionId: string | null;
  generatedCount: number;
  autoAccept: boolean;
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

  return (
    <GenerateReviewStep
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
