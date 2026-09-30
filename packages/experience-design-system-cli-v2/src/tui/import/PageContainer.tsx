import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../home/home.theme.js';
import { spawnV1Import, type PipelineResult } from './spawn-v1-import.js';

type Stage = 'running' | 'result';

export function ImportScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [stage, setStage] = useState<Stage>('running');
  const [result, setResult] = useState<PipelineResult>();
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    spawnV1Import({})
      .then(({ exitCode, result: pipelineResult }) => {
        if (pipelineResult) {
          setResult(pipelineResult);
          setStage('result');
        } else if (exitCode === 0) {
          // The v1 wizard exits cleanly when the user quits it (or finishes) and never prints a pipeline result.
          onDone();
        } else {
          setRunError(`Import process exited with code ${exitCode}`);
          setStage('result');
        }
      })
      .catch((err: unknown) => {
        setRunError(err instanceof Error ? err.message : String(err));
        setStage('result');
      });
  }, []);

  useInput(
    (input, key) => {
      if (key.return || key.escape || input === 'q') {
        onDone();
      }
    },
    { isActive: stage === 'result' },
  );

  if (stage === 'result') {
    const isSuccess = result && result.steps.every((s: { status: string }) => s.status !== 'failed');
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Import</Text>
        <Text> </Text>
        {isSuccess ? (
          <Text color={PALETTE.success}>✓ Import complete</Text>
        ) : (
          <Text color={PALETTE.error}>✗ Import failed{runError ? `: ${runError}` : ''}</Text>
        )}
        {result && (
          <Box flexDirection="column" marginTop={1}>
            {result.steps.map((step) => (
              <Text
                key={step.step}
                color={step.status === 'failed' ? PALETTE.error : undefined}
                dimColor={step.status === 'skipped'}
              >
                {step.status === 'complete' ? '✓' : step.status === 'skipped' ? '·' : '✗'} {step.step}
              </Text>
            ))}
          </Box>
        )}
        <Text> </Text>
        <Text dimColor>[Enter] Back to Start</Text>
      </Box>
    );
  }

  return <Box />;
}
