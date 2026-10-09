import React from 'react';
import { Text } from 'ink';
import { PALETTE } from '../theme.js';

export type HighlightPart = {
  text: string;
  color?: string;
  dim?: boolean;
};

export function HighlightedLine({ parts }: { parts: readonly HighlightPart[] }): React.ReactElement {
  return (
    <>
      {parts.map((part, i) => (
        <Text key={i} color={part.dim ? PALETTE.muted : part.color}>
          {part.text}
        </Text>
      ))}
    </>
  );
}
