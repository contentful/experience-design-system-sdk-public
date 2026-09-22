import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { FOCUS_MARKER, PALETTE } from '../../home/home.theme.js';
import {
  dsiConfigurationPath,
  readDsiConfiguration,
  writeDsiConfiguration,
  EMPTY_CONFIGURATION,
  type DsiConfiguration,
} from './config-store.js';

type FieldKey = keyof DsiConfiguration;

type Field = { key: FieldKey; label: string; maskable?: boolean };

const FIELDS: Field[] = [
  { key: 'space_id', label: 'Space ID' },
  { key: 'env_id', label: 'Environment ID' },
  { key: 'cma_token', label: 'CMA Token', maskable: true },
  { key: 'host', label: 'Host' },
];

function mask(value: string): string {
  return '•'.repeat(value.length);
}

export function ConfigurationScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<DsiConfiguration>(EMPTY_CONFIGURATION);
  const [focusIdx, setFocusIdx] = useState(0);
  const [mode, setMode] = useState<'navigate' | 'edit'>('navigate');
  const [editBuffer, setEditBuffer] = useState('');
  const [revealToken, setRevealToken] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    readDsiConfiguration().then((loaded) => {
      setConfig(loaded);
      setLoading(false);
    });
  }, []);

  const save = async (currentConfig: DsiConfiguration): Promise<boolean> => {
    try {
      await writeDsiConfiguration(currentConfig);
      return true;
    } catch (err) {
      setStatus({ kind: 'error', message: `Save failed: ${err instanceof Error ? err.message : String(err)}` });
      return false;
    }
  };

  useInput((input, key) => {
    if (loading) return;

    if (mode === 'edit') {
      if (key.return || key.escape) {
        const field = FIELDS[focusIdx]!.key;
        setConfig((c) => ({ ...c, [field]: editBuffer }));
        setMode('navigate');
        return;
      }
      if (key.backspace || key.delete) {
        setEditBuffer((b) => b.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setEditBuffer((b) => b + input);
      }
      return;
    }

    if (key.upArrow) {
      setFocusIdx((i) => (i - 1 + FIELDS.length) % FIELDS.length);
      setStatus(null);
      return;
    }
    if (key.downArrow) {
      setFocusIdx((i) => (i + 1) % FIELDS.length);
      setStatus(null);
      return;
    }
    if (key.return) {
      setEditBuffer(config[FIELDS[focusIdx]!.key]);
      setMode('edit');
      setStatus(null);
      return;
    }
    if (input === 'v' && FIELDS[focusIdx]!.maskable) {
      setRevealToken((r) => !r);
      return;
    }
    if (input === 's') {
      save(config).then((ok) => {
        if (ok) setStatus({ kind: 'success', message: 'Saved' });
      });
      return;
    }
    if (input === 'S') {
      save(config).then((ok) => {
        if (ok) onDone();
      });
      return;
    }
    if (input === 'q' || key.escape) {
      onDone();
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings › Configuration</Text>
      <Text> </Text>
      {loading ? (
        <Text color={PALETTE.muted}>Loading configuration…</Text>
      ) : (
        <>
          {FIELDS.map((field, i) => {
            const focused = i === focusIdx;
            const editing = focused && mode === 'edit';
            const rawValue = editing ? editBuffer : config[field.key];
            const displayValue = field.maskable && !revealToken ? mask(rawValue) : rawValue;

            return (
              <Text key={field.key} bold={focused} color={focused ? PALETTE.accent : undefined}>
                {focused ? `${FOCUS_MARKER} ` : '  '}
                {field.label}: {displayValue}
                {editing ? '▌' : ''}
              </Text>
            );
          })}
          <Text> </Text>
          <Text dimColor>Config file: {dsiConfigurationPath()}</Text>
          {status && <Text color={status.kind === 'success' ? PALETTE.success : PALETTE.error}>{status.message}</Text>}
          <Text> </Text>
          <Text dimColor>
            {mode === 'edit'
              ? '⏎/Esc commit edit'
              : `↑/↓ move · ⏎ edit · ${
                  FIELDS[focusIdx]!.maskable ? 'v reveal · ' : ''
                }s save · S save & quit · q quit (discard)`}
          </Text>
        </>
      )}
    </Box>
  );
}
