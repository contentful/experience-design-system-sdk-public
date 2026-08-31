import React from 'react';
import { Box, Text } from 'ink';

export interface MapTokensViewResult {
  agent: string;
  sessionId: string;
  applied: number;
  cached: boolean;
}

interface MapTokensViewProps {
  result: MapTokensViewResult;
  onExit: () => void;
}

export function MapTokensView({ result, onExit }: MapTokensViewProps): React.ReactElement {
  React.useEffect(() => {
    const timer = setTimeout(onExit, 100);
    return () => clearTimeout(timer);
  }, [onExit]);

  const summary = result.cached
    ? 'reused from cache'
    : `${result.applied} mapping${result.applied === 1 ? '' : 's'} applied`;

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green">✓ map tokens complete</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text dimColor>agent </Text>
          <Text>{result.agent}</Text>
        </Text>
        <Text>
          <Text dimColor>session </Text>
          <Text>{result.sessionId}</Text>
        </Text>
        <Text>
          <Text dimColor>result </Text>
          <Text>{summary}</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Run </Text>
        <Text>experience-design-system-cli print components</Text>
        <Text dimColor> to write components.json with the new mappings.</Text>
      </Box>
    </Box>
  );
}
