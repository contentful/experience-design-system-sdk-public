import { Box, Text } from 'ink';
import React from 'react';

/**
 * Feature 8: top-of-wizard banner shown while any custom skill prompt is
 * active. Persists at every step so the operator cannot miss that bundled
 * invariants are bypassed.
 */
export interface CustomPromptBannerProps {
  selectPromptPath?: string;
  generatePromptPath?: string;
}

export function CustomPromptBanner({
  selectPromptPath,
  generatePromptPath,
}: CustomPromptBannerProps): React.ReactElement | null {
  if (!selectPromptPath && !generatePromptPath) return null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        WARNING: Custom prompt active
      </Text>
      {selectPromptPath ? <Text color="yellow">select: {selectPromptPath}</Text> : null}
      {generatePromptPath ? <Text color="yellow">components: {generatePromptPath}</Text> : null}
      <Text color="yellow" dimColor>
        Bundled invariants (utility-wrapper rejection, description content rules) do NOT apply.
      </Text>
    </Box>
  );
}
