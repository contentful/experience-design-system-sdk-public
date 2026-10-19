import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../../theme.js';
import {
  RETENTION_CHOICES,
  readDebugModeSetting,
  writeDebugModeSetting,
  type DebugModeSetting,
} from './debug-mode-store.js';
import { startDebugRun, finishDebugRun } from '../../debug-store.js';
import { ControlHints } from '../../control-hints.js';

type Row = 'enabled' | 'retentionDays';
const ROWS: readonly Row[] = ['enabled', 'retentionDays'];

const nextRetention = (current: DebugModeSetting['retentionDays']): DebugModeSetting['retentionDays'] =>
  RETENTION_CHOICES[(RETENTION_CHOICES.indexOf(current) + 1) % RETENTION_CHOICES.length]!;

export function DebugModeScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [setting, setSetting] = useState<DebugModeSetting | null>(null);
  const [focus, setFocus] = useState<Row>('enabled');

  useEffect(() => {
    readDebugModeSetting().then((loaded) => {
      setSetting(loaded);
      startDebugRun({
        flow: 'settings/debug-mode',
        step: '01-debug-mode',
        menuOption: 'Debug Mode',
        inputs: { ...loaded },
      });
    });
  }, []);

  const change = (patch: Partial<DebugModeSetting>): void => {
    if (!setting) return;
    setSetting({ ...setting, ...patch });
    void writeDebugModeSetting(patch);
  };

  useInput((input, key) => {
    if (!setting) return;

    if (key.upArrow || key.downArrow) {
      setFocus((current) => ROWS[(ROWS.indexOf(current) + (key.downArrow ? 1 : ROWS.length - 1)) % ROWS.length]!);
      return;
    }
    if (key.return || input === ' ') {
      if (focus === 'enabled') change({ enabled: !setting.enabled });
      else change({ retentionDays: nextRetention(setting.retentionDays) });
      return;
    }
    if (key.escape || input === 'q') {
      void finishDebugRun({ outputs: { ...setting }, status: 'success', exitMethod: 'saved' });
      onDone();
    }
  });

  const marker = (row: Row): string => (focus === row ? '❯' : ' ');

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings › Debug Mode</Text>
      <Text> </Text>
      {setting ? (
        <>
          <Text>
            {marker('enabled')} Debug logging:{' '}
            <Text bold color={setting.enabled ? PALETTE.success : PALETTE.muted}>
              {setting.enabled ? 'On' : 'Off'}
            </Text>
          </Text>
          <Text>
            {marker('retentionDays')} Delete logs after:{' '}
            <Text bold color={PALETTE.accent}>
              {setting.retentionDays} days
            </Text>
          </Text>
          <Text> </Text>
          <Text color={PALETTE.muted}>Older logs are deleted the next time the CLI starts.</Text>
        </>
      ) : (
        <Text color={PALETTE.muted}>Loading…</Text>
      )}
      <Text> </Text>
      <ControlHints
        hints={[
          { keys: '↑/↓', label: 'move' },
          { keys: '⏎/Space', label: 'change' },
          { keys: 'Esc/q', label: 'back' },
        ]}
      />
    </Box>
  );
}
