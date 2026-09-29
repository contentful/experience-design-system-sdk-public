import React, { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../home/home.theme.js';
import { runCompositeImport, type PipelineResult } from './run-composite-import.js';

type Stage = 'prompt' | 'running' | 'done' | 'error';

export function ImportScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [stage, setStage] = useState<Stage>('prompt');
  const [result, setResult] = useState<PipelineResult>();
  const [runError, setRunError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  function startImport(): void {
    cancelledRef.current = false;
    setResult(undefined);
    setRunError(null);
    setStage('running');

    runCompositeImport({})
      .then(({ exitCode, result: pipelineResult }) => {
        if (cancelledRef.current) return;
        if (pipelineResult) {
          setResult(pipelineResult);
          setStage(exitCode === 0 && !pipelineResult.steps.some((s: { status: string }) => s.status === 'failed') ? 'done' : 'error');
        } else {
          setRunError(`Import process exited with code ${exitCode}`);
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
    if (stage === 'prompt') {
      if (key.return) {
        startImport();
        return;
      }
      if (key.escape || input === 'q') {
        onDone();
        return;
      }
      return;
    }

    if (stage === 'running') {
      if (key.escape) {
        cancelledRef.current = true;
        setStage('prompt');
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
        <Text color={PALETTE.accent}>Running import pipeline…</Text>
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
      <Text>Launch the experience import pipeline.</Text>
      <Text> </Text>
      <Text dimColor>[Enter] Start import [Esc/q] Exit</Text>
    </Box>
  );
}
