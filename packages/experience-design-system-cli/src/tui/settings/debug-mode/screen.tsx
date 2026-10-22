import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../../theme.js';
import {
  RETENTION_CHOICES,
  readDebugModeSetting,
  writeDebugModeSetting,
  type DebugModeSetting,
} from './debug-mode-store.js';
import { startDebugRun, finishDebugRun } from '../../debug-store.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { createTrail, diffSnapshots, scrubError, type Snapshot } from '../shared/debug-trail.js';

type Row = 'enabled' | 'retentionDays';
const ROWS: readonly Row[] = ['enabled', 'retentionDays'];

// The settings as flat text, for comparing what the screen opened with against what it closed with.
const snapshotOf = (setting: DebugModeSetting): Snapshot => ({
  enabled: String(setting.enabled),
  retentionDays: String(setting.retentionDays),
});

type Notice = { kind: 'success' | 'error'; text: string };

/**
 * Settings > Debug Mode. Logging is switched with Enter. The retention is chosen with ←/→, which only moves a highlight:
 * nothing is saved until Enter, and then the screen says so.
 */
export function DebugModeScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const active = useRef(true);
  const saving = useRef(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [setting, setSetting] = useState<DebugModeSetting | null>(null);
  const [focus, setFocus] = useState<Row>('enabled');
  // The retention under the highlight. It differs from the saved one until the user confirms it.
  const [pending, setPending] = useState<DebugModeSetting['retentionDays']>(
    RETENTION_CHOICES[RETENTION_CHOICES.length - 1]!,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  // What this visit adds to the debug log: the values it opened with, what the user did, and the last error.
  const visit = useRef({ trail: createTrail(), before: undefined as Snapshot | undefined, error: '' }).current;

  useEffect(() => {
    active.current = true;
    void readDebugModeSetting()
      .then((loaded) => {
        if (!active.current) return;
        setSetting(loaded);
        setPending(loaded.retentionDays);
        visit.before = snapshotOf(loaded);
        startDebugRun({
          flow: 'settings/debug-mode',
          step: '01-debug-mode',
          menuOption: 'Debug Mode',
          inputs: { ...loaded },
        });
      })
      .catch((error: unknown) => {
        if (active.current) setLoadingError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active.current = false;
    };
  }, []);

  const save = (patch: Partial<DebugModeSetting>, saved: string): void => {
    if (!setting || saving.current) return;
    saving.current = true;
    const fields = Object.keys(patch).join(', ');
    void writeDebugModeSetting(patch)
      .then(() => {
        if (!active.current) return;
        setSetting({ ...setting, ...patch });
        visit.trail.record(`saved ${fields}`);
        setNotice({ kind: 'success', text: `Saved: ${saved}` });
      })
      .catch((err: unknown) => {
        if (!active.current) return;
        visit.error = scrubError(err, []);
        visit.trail.record(`saving ${fields} failed`);
        setNotice({ kind: 'error', text: `Not saved: ${err instanceof Error ? err.message : String(err)}` });
      })
      .finally(() => {
        saving.current = false;
      });
  };

  // Finishes the log. A choice that was highlighted but never confirmed is reported on its own, since "I picked it and
  // nothing happened" is what people write in about.
  const endVisit = (current: DebugModeSetting): void => {
    const change = diffSnapshots(visit.before ?? snapshotOf(current), snapshotOf(current));
    void finishDebugRun({
      outputs: {
        ...current,
        ...change,
        ...(pending !== current.retentionDays ? { unsaved_retention_days: pending } : {}),
        actions: visit.trail.entries(),
        ...(visit.error ? { error: visit.error } : {}),
      },
      status: visit.error || saving.current ? 'error' : 'success',
      exitMethod: change.changed && !saving.current ? 'saved' : 'discarded',
    }).catch(() => {});
  };

  useInput((input, key) => {
    if (!active.current) return;
    if (key.escape || input === 'q') {
      active.current = false;
      if (setting) endVisit(setting);
      onDone();
      return;
    }
    if (!setting || saving.current) return;

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
  });

  // The same cursor and label styling as the other settings screens: accent when focused, muted otherwise.
  const marker = (row: Row): React.ReactElement => (
    <Text color={focus === row ? PALETTE.accent : undefined}>{focus === row ? '❯' : ' '}</Text>
  );
  const label = (row: Row, text: string): React.ReactElement => (
    <Text bold={focus === row} color={focus === row ? PALETTE.accent : PALETTE.muted}>
      {text}
    </Text>
  );

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings › Debug Mode</Text>
      <Text> </Text>
      {setting ? (
        <>
          <Box gap={1}>
            {marker('enabled')}
            {label('enabled', 'Debug logging:')}
            <Text bold color={setting.enabled ? PALETTE.success : PALETTE.muted}>
              {setting.enabled ? 'On' : 'Off'}
            </Text>
          </Box>
          <Box gap={1}>
            {marker('retentionDays')}
            {label('retentionDays', 'Delete logs after:')}
            {RETENTION_CHOICES.map((days) => {
              const highlighted = focus === 'retentionDays' && days === pending;
              const saved = days === setting.retentionDays;
              return (
                <Text
                  key={days}
                  bold={highlighted || saved}
                  underline={highlighted}
                  color={highlighted ? PALETTE.accent : saved ? PALETTE.success : PALETTE.muted}
                >
                  {`${saved ? '✓ ' : ''}${days} days`}
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
        <Text color={loadingError ? PALETTE.error : PALETTE.muted}>{loadingError ?? 'Loading…'}</Text>
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
