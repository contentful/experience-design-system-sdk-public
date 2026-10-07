import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../../home/home.theme.js';
import { finishDebugRun, startDebugRun } from '../../debug-store.js';
import { readImportDefaults, writeImportDefaults, type ImportDefaults } from './defaults-store.js';

type Field = keyof ImportDefaults;
type Stage = 'loading' | 'form' | 'saving' | 'saved';

const FIELD_ORDER: Field[] = ['componentDir', 'tokenFile'];

const FIELD_LABELS: Record<Field, string> = {
  componentDir: 'Component directory',
  tokenFile: 'Token file',
};

export function ImportDefaultsScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [stage, setStage] = useState<Stage>('loading');
  const [defaults, setDefaults] = useState<ImportDefaults>({ componentDir: '', tokenFile: '' });
  const [activeField, setActiveField] = useState<Field>('componentDir');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    readImportDefaults().then((saved) => {
      setDefaults(saved);
      setStage('form');
      startDebugRun({
        flow: 'settings/import-defaults',
        step: '01-import-defaults',
        menuOption: 'Import Defaults',
        inputs: { ...saved },
      });
    });
  }, []);

  function handleSave(): void {
    setStage('saving');
    setMessage(null);
    writeImportDefaults(defaults)
      .then(() => {
        setStage('saved');
        setMessage('Import defaults saved');
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
        void finishDebugRun({ outputs: { ...defaults }, status: 'success', exitMethod: 'saved' });
        onDone();
      }
      return;
    }

    if (key.escape) {
      void finishDebugRun({ outputs: {}, status: 'success', exitMethod: 'discarded' });
      onDone();
      return;
    }

    const idx = FIELD_ORDER.indexOf(activeField);
    if (key.tab || key.downArrow) {
      setActiveField(FIELD_ORDER[(idx + 1) % FIELD_ORDER.length]!);
      return;
    }
    if (key.upArrow) {
      setActiveField(FIELD_ORDER[(idx - 1 + FIELD_ORDER.length) % FIELD_ORDER.length]!);
      return;
    }
    if (key.return) {
      if (idx < FIELD_ORDER.length - 1) setActiveField(FIELD_ORDER[idx + 1]!);
      else handleSave();
      return;
    }
    if (key.backspace || key.delete) {
      setDefaults((d) => ({ ...d, [activeField]: d[activeField].slice(0, -1) }));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setDefaults((d) => ({ ...d, [activeField]: d[activeField] + input }));
    }
  });

  if (stage === 'loading') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Import Defaults</Text>
        <Text> </Text>
        <Text color={PALETTE.accent}>Loading...</Text>
      </Box>
    );
  }

  if (stage === 'saved') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Import Defaults</Text>
        <Text> </Text>
        <Text color={PALETTE.success}>✓ {message}</Text>
        <Text> </Text>
        <Text dimColor>[Enter/Esc] Back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Import Defaults</Text>
      <Text dimColor>Pre-filled when you start an import. Leave a field empty for no default.</Text>
      <Text> </Text>
      <Box flexDirection="column">
        {FIELD_ORDER.map((field) => {
          const isActive = activeField === field;
          const value = defaults[field];
          return (
            <Box key={field} gap={1}>
              <Text color={isActive ? PALETTE.accent : undefined}>{isActive ? '❯' : ' '}</Text>
              <Text bold={isActive}>{FIELD_LABELS[field]}:</Text>
              <Text>{value || <Text dimColor>(empty)</Text>}</Text>
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
      <Text dimColor>[↑/↓] Switch field · [Enter] Save/Next · [Esc] Back</Text>
    </Box>
  );
}
