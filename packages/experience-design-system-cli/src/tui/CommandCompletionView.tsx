import React from 'react';
import { Box, Text } from 'ink';

export type CompletionRow = {
  label: string;
  value: React.ReactNode;
};

export type CommandCompletionViewProps = {
  title: string;
  rows: CompletionRow[];
  command: string;
  instruction: string;
};

export function CommandCompletionView({
  title,
  rows,
  command,
  instruction,
}: CommandCompletionViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green">✓ {title} complete</Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.map((row) => (
          <Text key={row.label}>
            <Text dimColor>{row.label} </Text>
            <Text>{row.value}</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Run </Text>
        <Text>{command}</Text>
        <Text dimColor> {instruction}</Text>
      </Box>
    </Box>
  );
}
