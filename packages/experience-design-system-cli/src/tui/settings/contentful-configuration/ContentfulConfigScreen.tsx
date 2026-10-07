import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../../home/home.theme.js';
import { readCredentials, writeCredentials, type V1Credentials } from './config-store.js';
import { startDebugRun, finishDebugRun } from '../../debug-store.js';

type Field = 'spaceId' | 'environmentId' | 'cmaToken' | 'host' | 'defaultComponentDir' | 'defaultTokenFile';
type Stage = 'loading' | 'form' | 'saving' | 'saved';

const FIELD_ORDER: Field[] = [
  'spaceId',
  'environmentId',
  'cmaToken',
  'host',
  'defaultComponentDir',
  'defaultTokenFile',
];
function debugFields(config: V1Credentials | null): Record<string, unknown> {
  return {
    space_id: config?.spaceId ?? '',
    environment_id: config?.environmentId ?? '',
    cma_token: config?.cmaToken ?? '',
    host: config?.host ?? '',
    default_component_dir: config?.defaultComponentDir ?? '',
    default_token_file: config?.defaultTokenFile ?? '',
  };
}

const FIELD_LABELS: Record<Field, string> = {
  spaceId: 'Space ID',
  environmentId: 'Environment ID',
  cmaToken: 'CMA Token',
  host: 'API Host (optional)',
  defaultComponentDir: 'Default component directory (optional)',
  defaultTokenFile: 'Default token file (optional)',
};

export function ConfigurationScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [stage, setStage] = useState<Stage>('loading');
  const [config, setConfig] = useState<V1Credentials | null>(null);
  const [activeField, setActiveField] = useState<Field>('spaceId');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    readCredentials().then((cfg) => {
      setConfig(cfg);
      setStage('form');
      startDebugRun({
        flow: 'settings/contentful-configuration',
        step: '01-configuration',
        menuOption: 'Configuration',
        inputs: debugFields(cfg),
      });
    });
  }, []);

  function fieldValue(field: Field): string {
    if (!config) return '';
    return config[field] || '';
  }

  function setFieldValue(field: Field, value: string): void {
    if (!config) return;
    setConfig({ ...config, [field]: value });
  }

  function handleSave(): void {
    if (!config) return;
    setStage('saving');
    setMessage(null);
    writeCredentials(config)
      .then(() => {
        setStage('saved');
        setMessage('Configuration saved');
      })
      .catch((err: unknown) => {
        setMessage(err instanceof Error ? err.message : 'Failed to save');
        setStage('form');
      });
  }

  useInput((input, key) => {
    if (stage === 'loading' || stage === 'saving') return;

    if (stage === 'saved') {
      if (key.return || key.escape || input === 'q') {
        void finishDebugRun({ outputs: debugFields(config), status: 'success', exitMethod: 'saved' });
        onDone();
      }
      return;
    }

    if (key.escape || input === 'q') {
      void finishDebugRun({ outputs: {}, status: 'success', exitMethod: 'discarded' });
      onDone();
      return;
    }

    if (key.tab || key.downArrow) {
      const idx = FIELD_ORDER.indexOf(activeField);
      setActiveField(FIELD_ORDER[(idx + 1) % FIELD_ORDER.length]!);
      return;
    }

    if (key.upArrow) {
      const idx = FIELD_ORDER.indexOf(activeField);
      setActiveField(FIELD_ORDER[(idx - 1 + FIELD_ORDER.length) % FIELD_ORDER.length]!);
      return;
    }

    if (key.return) {
      const idx = FIELD_ORDER.indexOf(activeField);
      if (idx < FIELD_ORDER.length - 1) {
        setActiveField(FIELD_ORDER[idx + 1]!);
      } else {
        handleSave();
      }
      return;
    }

    if (key.backspace || key.delete) {
      const current = fieldValue(activeField);
      setFieldValue(activeField, current.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setFieldValue(activeField, fieldValue(activeField) + input);
    }
  });

  if (stage === 'loading') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Configuration</Text>
        <Text> </Text>
        <Text color={PALETTE.accent}>Loading...</Text>
      </Box>
    );
  }

  if (stage === 'saved') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Configuration</Text>
        <Text> </Text>
        <Text color={PALETTE.success}>✓ {message}</Text>
        <Text> </Text>
        <Text dimColor>[Enter] Back to Settings</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Configuration</Text>
      <Text> </Text>
      <Text>Contentful API Credentials</Text>
      <Text> </Text>
      <Box flexDirection="column">
        {FIELD_ORDER.map((field) => {
          const isActive = activeField === field;
          const value = fieldValue(field);
          const display = field === 'cmaToken' ? '•'.repeat(value.length) : value;
          return (
            <Box key={field} gap={1}>
              <Text color={isActive ? PALETTE.accent : undefined}>{isActive ? '❯' : ' '}</Text>
              <Text bold={isActive}>{FIELD_LABELS[field]}:</Text>
              <Text>{display || <Text dimColor>(empty)</Text>}</Text>
            </Box>
          );
        })}
      </Box>
      {message && (
        <>
          <Text> </Text>
          <Text color={PALETTE.error}>✗ {message}</Text>
        </>
      )}
      <Text> </Text>
      <Text dimColor>[↑/↓] Switch field · [Enter] Save/Next · [Esc/q] Back</Text>
    </Box>
  );
}
