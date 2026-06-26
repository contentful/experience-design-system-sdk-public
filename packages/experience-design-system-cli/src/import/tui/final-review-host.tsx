import { Box, Text } from 'ink';
import React from 'react';
import { GenerateReviewStep } from './steps/GenerateReviewStep.js';

export type FinalReviewHostProps = {
  extractSessionId: string | null;
  generatedCount: number;
  autoAccept: boolean;
  onFinalize: (accepted: number, rejected: number) => void;
  onQuit: () => void;
};

export function FinalReviewHost({
  extractSessionId,
  generatedCount,
  autoAccept,
  onFinalize,
  onQuit,
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
