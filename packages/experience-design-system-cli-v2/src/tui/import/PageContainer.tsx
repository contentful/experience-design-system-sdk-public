import React, { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../home/home.theme.js';
import { runCompositeImport, type PipelineResult } from './run-composite-import.js';

type Field = 'spaceId' | 'environmentId' | 'cmaToken';

type Stage = 'form' | 'running' | 'done' | 'error';

const FIELD_ORDER: Field[] = ['spaceId', 'environmentId', 'cmaToken'];
const FIELD_LABELS: Record<Field, string> = {
  spaceId: 'Space ID',
  environmentId: 'Environment ID',
  cmaToken: 'CMA Token',
};

export function ImportScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [stage, setStage] = useState<Stage>('form');
  const [spaceId, setSpaceId] = useState('');
  const [environmentId, setEnvironmentId] = useState('master');
  const [cmaToken, setCmaToken] = useState('');
  const [activeField, setActiveField] = useState<Field>('spaceId');
  const [formError, setFormError] = useState<string | null>(null);
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [result, setResult] = useState<PipelineResult>();
  const [runError, setRunError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  function fieldValue(field: Field): string {
    if (field === 'spaceId') return spaceId;
    if (field === 'environmentId') return environmentId;
    return cmaToken;
  }

  function setFieldValue(field: Field, value: string): void {
    if (field === 'spaceId') setSpaceId(value);
    else if (field === 'environmentId') setEnvironmentId(value);
    else setCmaToken(value);
  }

  function startImport(): void {
    if (!spaceId.trim() || !environmentId.trim() || !cmaToken.trim()) {
      setFormError('All fields are required.');
      return;
    }
    setFormError(null);
    cancelledRef.current = false;
    setProgressLines([]);
    setResult(undefined);
    setRunError(null);
    setStage('running');

    runCompositeImport({
      credentials: { spaceId: spaceId.trim(), environmentId: environmentId.trim(), cmaToken: cmaToken.trim() },
      onProgress: (line) => {
        if (cancelledRef.current) return;
        setProgressLines((lines) => [...lines, line]);
      },
    })
      .then(({ exitCode, result: pipelineResult }) => {
        if (cancelledRef.current) return;
        if (pipelineResult) {
          setResult(pipelineResult);
          setStage(exitCode === 0 && !pipelineResult.steps.some((s) => s.status === 'failed') ? 'done' : 'error');
        } else {
          setRunError(`Import process exited with code ${exitCode} and produced no result.`);
          setStage('error');
        }
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return;
        setRunError(err instanceof Error ? err.message : String(err));
        setStage('error');
      });
  }

  useInput((input, key) => {
    if (stage === 'form') {
      if (key.return) {
        const idx = FIELD_ORDER.indexOf(activeField);
        if (idx < FIELD_ORDER.length - 1) {
          setActiveField(FIELD_ORDER[idx + 1]!);
        } else {
          startImport();
        }
        return;
      }
      if (key.tab) {
        const idx = FIELD_ORDER.indexOf(activeField);
        setActiveField(FIELD_ORDER[(idx + 1) % FIELD_ORDER.length]!);
        return;
      }
      if (key.escape || input === 'q') {
        onDone();
        return;
      }
      if (key.backspace || key.delete) {
        setFieldValue(activeField, fieldValue(activeField).slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFieldValue(activeField, fieldValue(activeField) + input);
      }
      return;
    }

    if (stage === 'running') {
      if (key.escape) {
        cancelledRef.current = true;
        setStage('form');
      }
      return;
    }

    // done / error
    if (key.return || key.escape || input === 'q') {
      onDone();
    }
  });

  if (stage === 'running') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Import</Text>
        <Text> </Text>
        <Text color={PALETTE.accent}>Running composite import…</Text>
        <Text> </Text>
        <Box flexDirection="column">
          {progressLines.slice(-20).map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
        <Text> </Text>
        <Text dimColor>[Esc] Cancel</Text>
      </Box>
    );
  }

  if (stage === 'done' || stage === 'error') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Import</Text>
        <Text> </Text>
        {stage === 'done' ? (
          <Text color={PALETTE.success}>Import complete.</Text>
        ) : (
          <Text color={PALETTE.error}>Import failed{runError ? `: ${runError}` : '.'}</Text>
        )}
        {result && (
          <Box flexDirection="column" marginTop={1}>
            {result.steps.map((step) => (
              <Text key={step.step} color={step.status === 'failed' ? PALETTE.error : undefined}>
                {step.status === 'complete' ? '✓' : step.status === 'skipped' ? '·' : '✗'} {step.step}
                {step.error ? ` — ${step.error}` : ''}
              </Text>
            ))}
          </Box>
        )}
        <Text> </Text>
        <Text dimColor>[Enter/Esc/q] Back to Start</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Import</Text>
      <Text> </Text>
      <Text>Enter the Contentful space to import into (composite mode, generate only — no push).</Text>
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
      {formError && (
        <>
          <Text> </Text>
          <Text color={PALETTE.error}>✗ {formError}</Text>
        </>
      )}
      <Text> </Text>
      <Text dimColor>[Enter] Next field / Start import [Tab] Switch field [Esc/q] Exit</Text>
    </Box>
  );
}
