import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../theme.js';
import { startDebugRun, finishDebugRun } from '../debug-store.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { readHelpInfo, type HelpInfo, type HelpRow } from './help-info.js';

function Section({ title, rows }: { title: string; rows: HelpRow[] }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color={PALETTE.accent}>
        {title}
      </Text>
      {rows.map((row) => (
        <Box key={row.label} gap={1}>
          <Box width={16} flexShrink={0}>
            <Text color={PALETTE.muted}>{row.label}</Text>
          </Box>
          <Text>{row.value}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function HelpScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const active = useRef(true);
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<HelpInfo>();

  useEffect(() => {
    active.current = true;
    startDebugRun({ flow: 'help', step: '01-help', menuOption: 'Help', inputs: {} });
    void readHelpInfo()
      .then((value) => {
        if (active.current) setInfo(value);
      })
      .catch((failure: unknown) => {
        if (active.current) setError(String(failure));
      });
    return () => {
      active.current = false;
    };
  }, []);

  const leave = (exitMethod: 'saved' | 'discarded'): void => {
    active.current = false;
    void finishDebugRun({
      outputs: {},
      status: error ? 'error' : 'success',
      exitMethod: error ? 'discarded' : exitMethod,
    }).catch(() => {});
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
      {error ? (
        <Text color={PALETTE.error}>{error}</Text>
      ) : info ? (
        <>
          <Section title="Where things are stored" rows={info.storage} />
          <Section title="Troubleshooting" rows={info.troubleshooting} />
          <Text color={PALETTE.muted}>
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
          { keys: 'Esc/q', label: 'back' },
        ]}
      />
    </Box>
  );
}
