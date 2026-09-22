import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { FOCUS_MARKER, PALETTE } from '../../home/home.theme.js';
import {
  dsiConfigurationPath,
  readDsiConfiguration,
  writeDsiConfiguration,
  EMPTY_CONFIGURATION,
  type DsiConfiguration,
} from './config-store.js';
import { useConfigurationControls, type Field } from './controls.js';

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
  const [configPath, setConfigPath] = useState('');

  useEffect(() => {
    setConfigPath(dsiConfigurationPath());
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

  useConfigurationControls({
    loading,
    mode,
    setMode,
    focusIdx,
    setFocusIdx,
    editBuffer,
    setEditBuffer,
    config,
    setConfig,
    setStatus,
    setRevealToken,
    fields: FIELDS,
    save,
    onDone,
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
          <Text dimColor>Config file: {configPath}</Text>
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
