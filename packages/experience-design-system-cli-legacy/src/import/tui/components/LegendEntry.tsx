import React from 'react';
import { Text } from 'ink';
import { PALETTE } from '../../../analyze/select/tui/theme.js';

export function legendEntry(keyBracket: string, label: string, active = false): React.ReactElement {
  return (
    <Text key={keyBracket + label}>
      <Text color={active ? PALETTE.warning : PALETTE.info} inverse={active}>
        {keyBracket}
      </Text>
      <Text color={active ? PALETTE.warning : undefined} inverse={active} dimColor={!active}>
        {' ' + label}
      </Text>
    </Text>
  );
}
