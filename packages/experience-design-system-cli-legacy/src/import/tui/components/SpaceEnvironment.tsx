import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../analyze/select/tui/theme.js';

type SpaceEnvironmentProps = {
  spaceId: string;
  environmentId: string;
};

export function SpaceEnvironment({ spaceId, environmentId }: SpaceEnvironmentProps): React.ReactElement {
  return (
    <Box gap={1} marginTop={1}>
      <Text color={PALETTE.muted}>Space:</Text>
      <Text>{spaceId}</Text>
      <Text color={PALETTE.muted}>/</Text>
      <Text color={PALETTE.muted}>Environment:</Text>
      <Text>{environmentId}</Text>
    </Box>
  );
}
