import React from 'react';
import { Box, Text } from 'ink';

type HelpOverlayProps = {
  mode: 'analyze' | 'validate' | 'review';
  onClose: () => void;
};

// Pure render — input handled by inputToAction in App.
export function HelpOverlay({ mode, onClose: _onClose }: HelpOverlayProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" padding={1} width={46}>
      <Text bold>{'─'.repeat(18) + ' Help ' + '─'.repeat(18)}</Text>
      <Text> </Text>
      <Text bold>Navigation</Text>
      <Text>{'  ↑ / k / PgUp     Scroll up'}</Text>
      <Text>{'  ↓ / j / PgDn     Scroll down'}</Text>
      <Text>{'  g / Home         Jump to top'}</Text>
      <Text>{'  G / End          Jump to bottom'}</Text>
      {mode === 'review' && (
        <>
          <Text> </Text>
          <Text bold>[Review mode only]</Text>
          <Text>{'  Tab              Toggle sidebar/detail'}</Text>
          <Text>{'  a                Accept component'}</Text>
          <Text>{'  r                Reject component'}</Text>
          <Text>{'  e                Edit proposal'}</Text>
          <Text>{'  s                Toggle source code'}</Text>
          <Text>{'  A                Approve all'}</Text>
          <Text>{'  F                Open finalize dialog'}</Text>
          <Text>{'  Ctrl+S           Save draft'}</Text>
          <Text>{'  Ctrl+Z           Undo'}</Text>
          <Text>{'  Esc              Exit edit / close'}</Text>
        </>
      )}
      <Text> </Text>
      <Text>{'  ?                Close help'}</Text>
      <Text>{'  q                Quit'}</Text>
    </Box>
  );
}
