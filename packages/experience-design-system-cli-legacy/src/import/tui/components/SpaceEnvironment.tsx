import React from 'react';
import { Box, Text } from 'ink';

type SpaceEnvironmentProps = {
  spaceId: string;
  environmentId: string;
};

export function SpaceEnvironment({ spaceId, environmentId }: SpaceEnvironmentProps): React.ReactElement {
  return (
    <Box gap={1} marginTop={1}>
      <Text dimColor>Space:</Text>
      <Text>{spaceId}</Text>
      <Text dimColor>/</Text>
      <Text dimColor>Environment:</Text>
      <Text>{environmentId}</Text>
    </Box>
  );
}
