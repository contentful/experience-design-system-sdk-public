import React from 'react';
import { Box, Text } from 'ink';

export interface GenerateViewResult {
  skill: string;
  agent: string;
  sessionId: string;
}

interface GenerateViewProps {
  result: GenerateViewResult;
  onExit: () => void;
}

export function GenerateView({ result, onExit }: GenerateViewProps): React.ReactElement {
  React.useEffect(() => {
    const timer = setTimeout(onExit, 100);
    return () => clearTimeout(timer);
  }, [onExit]);

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green">✓ generate complete</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text dimColor>skill </Text>
          <Text>{result.skill}</Text>
        </Text>
        <Text>
          <Text dimColor>agent </Text>
          <Text>{result.agent}</Text>
        </Text>
        <Text>
          <Text dimColor>session </Text>
          <Text>{result.sessionId}</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Run </Text>
        <Text>experience-design-system-cli print {result.skill}</Text>
        <Text dimColor> to write the output file.</Text>
      </Box>
    </Box>
  );
}
