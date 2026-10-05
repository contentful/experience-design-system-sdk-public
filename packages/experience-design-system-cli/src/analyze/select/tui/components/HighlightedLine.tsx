import React from 'react';
import { Text } from 'ink';

export type HighlightPart = {
  text: string;
  color?: string;
  dim?: boolean;
};

export function HighlightedLine({ parts }: { parts: readonly HighlightPart[] }): React.ReactElement {
  return (
    <>
      {parts.map((part, i) => (
        <Text key={i} color={part.color} dimColor={part.dim}>
          {part.text}
        </Text>
      ))}
    </>
  );
}
