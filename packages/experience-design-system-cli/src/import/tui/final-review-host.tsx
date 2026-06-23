import { Box, Text } from 'ink';
import React from 'react';
import { GenerateReviewStep } from './steps/GenerateReviewStep.js';

export type FinalReviewHostProps = {
  extractSessionId: string | null;
  generatedCount: number;
  autoAccept: boolean;
  onFinalize: (accepted: number, rejected: number) => void;
  onQuit: () => void;
  // Feature 2 plumbing — passed straight through to GenerateReviewStep.
  livePreview?: boolean;
  spaceId?: string;
  environmentId?: string;
  cmaToken?: string;
  host?: string;
  tokensPath?: string;
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
}: FinalReviewHostProps): React.ReactElement {
  if (!extractSessionId) {
    return (
      <Box paddingX={2} paddingY={1}>
        <Text color="red">Error: no session ID — cannot load generated definitions.</Text>
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
    />
  );
}

function FinalReviewAutoAccept({
  generatedCount,
  onFinalize,
}: {
  generatedCount: number;
  onFinalize: (accepted: number, rejected: number) => void;
}): React.ReactElement {
  React.useEffect(() => {
    onFinalize(generatedCount, 0);
    // fire once on mount; deps intentionally empty so a re-render with new generatedCount doesn't double-finalize
  }, []);
  return (
    <Box paddingX={2} paddingY={1}>
      <Text dimColor>Auto-accepting {generatedCount} generated components...</Text>
    </Box>
  );
}
