import React from 'react';
import { Text } from 'ink';
import { PALETTE } from './home/home.theme.js';

// The one control-hint line for every screen outside the import flow. Matches the Home screen:
// muted slate text, "keys label" pairs separated by a middle dot.
export function ControlHints({ hints }: { hints: readonly { keys: string; label: string }[] }): React.ReactElement {
  return <Text color={PALETTE.muted}>{hints.map((hint) => `${hint.keys} ${hint.label}`).join(' · ')}</Text>;
}
