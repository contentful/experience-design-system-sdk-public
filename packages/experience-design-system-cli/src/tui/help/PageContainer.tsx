import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../home/home.theme.js';
import { startDebugRun, finishDebugRun } from '../debug-store.js';
import { ControlHints } from '../control-hints.js';
import { readHelpInfo, type HelpInfo, type HelpRow } from './help-info.js';

function Section({ title, rows }: { title: string; rows: HelpRow[] }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color={PALETTE.accent}>
        {title}
      </Text>
      {rows.map((row) => (
        <Box key={row.label} gap={1}>
          <Box width={14} flexShrink={0}>
            <Text dimColor>{row.label}</Text>
          </Box>
          <Text>{row.value}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function HelpScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [info, setInfo] = useState<HelpInfo>();

  useEffect(() => {
    startDebugRun({ flow: 'help', step: '01-help', menuOption: 'Help', inputs: {} });
    void readHelpInfo().then(setInfo);
  }, []);

  const leave = (exitMethod: 'saved' | 'discarded'): void => {
    void finishDebugRun({ outputs: {}, status: 'success', exitMethod });
    onDone();
  };

  useInput((input, key) => {
    if (key.return) {
      leave('saved');
      return;
    }
    if (key.escape || input === 'q') {
      leave('discarded');
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Text bold>Help</Text>
      {info ? (
        <>
          <Section title="Where things are stored" rows={info.storage} />
          <Section title="Troubleshooting" rows={info.troubleshooting} />
          <Text dimColor>
            Hit a problem? Turn on Debug Mode in Settings, reproduce it, then share the session folder above. The CMA
            token is redacted from those logs.
          </Text>
        </>
      ) : (
        <Text color={PALETTE.accent}>Loading...</Text>
      )}
      <ControlHints
        hints={[
          { keys: '⏎', label: 'done' },
          { keys: 'Esc/q', label: 'back to start' },
        ]}
      />
    </Box>
  );
}
