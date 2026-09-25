import { Box, Text } from 'ink';
import { PALETTE } from '../../analyze/select/tui/theme.js';
import React from 'react';
import { GenerateReviewStep } from './steps/GenerateReviewStep.js';
import type { ReviewStepProps } from './review-step-props.js';

export type FinalReviewHostProps = Omit<ReviewStepProps, 'extractSessionId'> & {
  extractSessionId: string | null;
};

export function FinalReviewHost({
  extractSessionId,
  tokenSessionId,
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

  return (
    <GenerateReviewStep
      extractSessionId={extractSessionId}
      tokenSessionId={tokenSessionId}
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
