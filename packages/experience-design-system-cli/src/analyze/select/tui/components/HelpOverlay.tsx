import React from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../hooks/useImmediateInput.js';

export type HelpSection = {
  title: string;
  entries: { keys: string; label: string }[];
};

type HelpOverlayProps =
  | { mode: 'analyze' | 'validate' | 'review'; sections?: undefined; onClose: () => void }
  | { mode?: undefined; sections: HelpSection[]; onClose: () => void };

export function HelpOverlay(props: HelpOverlayProps): React.ReactElement {
  const { onClose } = props;
  useImmediateInput((input, key) => {
    if (input === '?' || key.escape) {
      onClose();
    }
  });

  if (props.sections) {
    return (
      <Box flexDirection="column" borderStyle="round" padding={1} width={46}>
        <Text bold>{'─'.repeat(18) + ' Help ' + '─'.repeat(18)}</Text>
        {props.sections.map((section) => (
          <React.Fragment key={section.title}>
            <Text> </Text>
            <Text bold>{section.title}</Text>
            {section.entries.map((entry) => (
              <Text key={entry.keys + entry.label}>
                {entry.keys ? '  ' + entry.keys.padEnd(16) + ' ' + entry.label : '  ' + entry.label}
              </Text>
            ))}
          </React.Fragment>
        ))}
      </Box>
    );
  }

  const mode = props.mode;
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
          <Text>{'  Ctrl+Y           Redo'}</Text>
          <Text>{'  Esc              Exit edit / close'}</Text>
        </>
      )}
      <Text> </Text>
      <Text>{'  ?                Close help'}</Text>
      <Text>{'  q                Quit'}</Text>
    </Box>
  );
}
