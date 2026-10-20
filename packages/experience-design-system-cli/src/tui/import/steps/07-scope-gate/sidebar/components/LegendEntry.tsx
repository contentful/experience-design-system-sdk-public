import React from 'react';
import { Text } from 'ink';
import { PALETTE } from '@tui/theme.js';

export function legendEntry(keyBracket: string, label: string, active = false): React.ReactElement {
  return (
    <Text key={keyBracket + label}>
      <Text color={active ? PALETTE.warning : PALETTE.accent} inverse={active}>
        {keyBracket}
      </Text>
      <Text color={active ? PALETTE.warning : undefined} inverse={active}>
        {' ' + label}
      </Text>
    </Text>
  );
}
