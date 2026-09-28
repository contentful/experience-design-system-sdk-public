import { Box, Text } from 'ink';
import { PALETTE } from '../../analyze/select/tui/theme.js';
import React from 'react';

export interface CustomPromptBannerProps {
  generatePromptPath?: string;
}

export function CustomPromptBanner({ generatePromptPath }: CustomPromptBannerProps): React.ReactElement | null {
  if (!generatePromptPath) return null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.warning} paddingX={1}>
      <Text color={PALETTE.warning} bold>
        WARNING: Custom prompt active
      </Text>
      {generatePromptPath ? <Text color={PALETTE.warning}>components: {generatePromptPath}</Text> : null}
      <Text color={PALETTE.warning} dimColor>
        Bundled invariants (utility-wrapper rejection, description content rules) do NOT apply.
      </Text>
    </Box>
  );
}
