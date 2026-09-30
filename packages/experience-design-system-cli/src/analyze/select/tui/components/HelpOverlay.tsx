import React from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../hooks/useImmediateInput.js';
import { useTerminalSize } from '../../../../tui/use-terminal-size.js';

export type HelpSection = {
  title: string;
  entries: { keys: string; label: string }[];
};

type HelpOverlayProps =
  | { mode: 'analyze' | 'validate' | 'review'; sections?: undefined; onClose: () => void; handleInput?: boolean }
  | { mode?: undefined; sections: HelpSection[]; onClose: () => void; handleInput?: boolean };

export function HelpOverlay(props: HelpOverlayProps): React.ReactElement {
  const { onClose } = props;
  const { columns: terminalColumns, rows: terminalRows } = useTerminalSize();
  const panelWidth = Math.max(10, Math.min(64, terminalColumns - 2));
  const panelHeight = Math.max(5, terminalRows - 3);
  const titleRule = Math.max(0, Math.floor((panelWidth - 10) / 2));
  useImmediateInput(
    (input, key) => {
      if (input === 'h' || key.escape) onClose();
    },
    props.handleInput !== false,
  );

  if (props.sections) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        padding={1}
        width={panelWidth}
        height={panelHeight}
        overflowY="hidden"
      >
        <Text bold>{'─'.repeat(titleRule) + ' Help ' + '─'.repeat(titleRule)}</Text>
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
    <Box
      flexDirection="column"
      borderStyle="round"
      padding={1}
      width={panelWidth}
      height={panelHeight}
      overflowY="hidden"
    >
      <Text bold>{'─'.repeat(titleRule) + ' Help ' + '─'.repeat(titleRule)}</Text>
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
      <Text>{'  h                Close help'}</Text>
      <Text>{'  q                Quit'}</Text>
    </Box>
  );
}
