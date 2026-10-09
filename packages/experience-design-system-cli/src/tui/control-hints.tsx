import React from 'react';
import { Text } from 'ink';

// The one control-hint line for every screen outside the import flow. Matches the Home screen:
// default-colour text (hints carry meaning, so no dim or gray), "[keys] label" pairs separated by a middle dot.
export function ControlHints({ hints }: { hints: readonly { keys: string; label: string }[] }): React.ReactElement {
  return <Text>{hints.map((hint) => `[${hint.keys}] ${hint.label}`).join(' · ')}</Text>;
}
