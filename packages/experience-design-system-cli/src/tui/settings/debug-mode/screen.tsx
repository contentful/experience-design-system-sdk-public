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

type Notice = { kind: 'success' | 'error'; text: string };

/**
 * Settings > Debug Mode. Logging is switched with Enter. The retention is chosen with ←/→, which only moves a highlight:
 * nothing is saved until Enter, and then the screen says so.
 */
export function DebugModeScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [setting, setSetting] = useState<DebugModeSetting | null>(null);
  const [focus, setFocus] = useState<Row>('enabled');
  // The retention under the highlight. It differs from the saved one until the user confirms it.
  const [pending, setPending] = useState<DebugModeSetting['retentionDays']>(
    RETENTION_CHOICES[RETENTION_CHOICES.length - 1]!,
  );
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    readDebugModeSetting().then((loaded) => {
      setSetting(loaded);
      setPending(loaded.retentionDays);
      startDebugRun({
        flow: 'settings/debug-mode',
        step: '01-debug-mode',
        menuOption: 'Debug Mode',
        inputs: { ...loaded },
      });
    });
  }, []);

  const save = (patch: Partial<DebugModeSetting>, saved: string): void => {
    if (!setting) return;
    writeDebugModeSetting(patch)
      .then(() => {
        setSetting({ ...setting, ...patch });
        setNotice({ kind: 'success', text: `Saved: ${saved}` });
      })
      .catch((err: unknown) =>
        setNotice({ kind: 'error', text: `Not saved: ${err instanceof Error ? err.message : String(err)}` }),
      );
  };

  useInput((input, key) => {
    if (!setting) return;

    if (key.upArrow || key.downArrow) {
      setFocus((current) => ROWS[(ROWS.indexOf(current) + (key.downArrow ? 1 : ROWS.length - 1)) % ROWS.length]!);
      setNotice(null);
      return;
    }
    if ((key.leftArrow || key.rightArrow) && focus === 'retentionDays') {
      const index = RETENTION_CHOICES.indexOf(pending) + (key.rightArrow ? 1 : -1);
      setPending(RETENTION_CHOICES[Math.min(Math.max(index, 0), RETENTION_CHOICES.length - 1)]!);
      setNotice(null);
      return;
    }
    if (focus === 'enabled' && (key.return || input === ' ')) {
      const enabled = !setting.enabled;
      save({ enabled }, `debug logging is ${enabled ? 'on' : 'off'}`);
      return;
    }
    if (focus === 'retentionDays' && key.return) {
      save({ retentionDays: pending }, `logs are deleted after ${pending} days`);
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
          <Box gap={1}>
            <Text>{marker('retentionDays')} Delete logs after:</Text>
            {RETENTION_CHOICES.map((days) => {
              const highlighted = focus === 'retentionDays' && days === pending;
              return (
                <Text
                  key={days}
                  inverse={highlighted}
                  bold={highlighted || days === setting.retentionDays}
                  color={
                    highlighted ? PALETTE.accent : days === setting.retentionDays ? PALETTE.success : PALETTE.muted
                  }
                >
                  {` ${days === setting.retentionDays ? '✓ ' : ''}${days} days `}
                </Text>
              );
            })}
          </Box>
          <Text> </Text>
          {notice ? (
            <Text color={notice.kind === 'success' ? PALETTE.success : PALETTE.error}>
              {notice.kind === 'success' ? '✓' : '✗'} {notice.text}
            </Text>
          ) : (
            <Text color={PALETTE.muted}>
              ✓ marks what is saved. Older logs are deleted the next time the CLI starts.
            </Text>
          )}
        </>
      ) : (
        <Text color={PALETTE.muted}>Loading…</Text>
      )}
      <Text> </Text>
      <ControlHints
        hints={[
          { keys: '↑/↓', label: 'move' },
          ...(focus === 'retentionDays'
            ? [
                { keys: '←/→', label: 'choose' },
                { keys: '⏎', label: 'save' },
              ]
            : [{ keys: '⏎/Space', label: 'toggle' }]),
          { keys: 'Esc/q', label: 'back' },
        ]}
      />
    </Box>
  );
}
