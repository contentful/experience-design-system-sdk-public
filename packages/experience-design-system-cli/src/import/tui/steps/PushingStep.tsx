import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { PushExpected, PushProgress } from '../push-progress.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

type PushingStepProps = {
  stepNumber: number;
  totalSteps: number;
  expected: PushExpected | null;
  progress: PushProgress;
};

type ActionKey = 'create' | 'update' | 'remove';

const ACTION_LABELS: Record<ActionKey, string> = {
  create: 'Creating',
  update: 'Updating',
  remove: 'Deleting',
};

function ActionRow({
  label,
  expectedCount,
  progress,
}: {
  label: string;
  expectedCount: number;
  progress: PushProgress;
}): React.ReactElement {
  // Per spec: do NOT fake proportional tallies. Left side stays "?/N" until
  // terminal status surfaces real per-action counts.
  const left = progress && progress.kind === 'progress' ? '?' : '?';
  return (
    <Box gap={1}>
      <Text>  {label}</Text>
      <Text dimColor>
        {left}/{expectedCount}
      </Text>
    </Box>
  );
}

function EntitySection({
  title,
  counts,
  progress,
}: {
  title: string;
  counts: { create: number; update: number; remove: number };
  progress: PushProgress;
}): React.ReactElement | null {
  const visibleActions = (['create', 'update', 'remove'] as ActionKey[]).filter(
    (k) => counts[k] > 0,
  );
  if (visibleActions.length === 0) return null;
  return (
    <Box flexDirection="column" gap={0}>
      <Text bold>{title}</Text>
      {visibleActions.map((k) => (
        <ActionRow
          key={k}
          label={ACTION_LABELS[k]}
          expectedCount={counts[k]}
          progress={progress}
        />
      ))}
    </Box>
  );
}

export function PushingStep({
  stepNumber,
  totalSteps,
  expected,
  progress,
}: PushingStepProps): React.ReactElement {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const spinner = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(spinner);
      clearInterval(timer);
    };
  }, []);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const operationId =
    progress && progress.kind === 'queued'
      ? progress.operationId
      : null;

  const showGlobal = progress && progress.kind === 'progress';
  const showCurrent =
    progress && progress.kind === 'progress' && progress.current
      ? progress.current
      : null;

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Box flexDirection="column" gap={0}>
        <Text dimColor>{'─'.repeat(40)}</Text>
        <Box gap={1}>
          <Text bold>
            Step {stepNumber} of {totalSteps}
          </Text>
          <Text bold>—</Text>
          <Text bold>Push to Contentful</Text>
        </Box>
        <Text dimColor>{'─'.repeat(40)}</Text>
      </Box>

      <Text>Writing component types and design tokens to your Contentful space...</Text>

      {operationId && (
        <Box gap={1}>
          <Text dimColor>Operation:</Text>
          <Text>{operationId}</Text>
        </Box>
      )}

      {expected && (
        <Box flexDirection="column" gap={1}>
          <EntitySection
            title="Component types"
            counts={expected.componentTypes}
            progress={progress}
          />
          <EntitySection
            title="Design tokens"
            counts={expected.designTokens}
            progress={progress}
          />
        </Box>
      )}

      {showGlobal && progress && progress.kind === 'progress' && (
        <Box gap={1}>
          <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>
          <Text dimColor>
            {progress.processed}/{progress.total} entities
          </Text>
        </Box>
      )}

      {showCurrent && (
        <Box gap={1}>
          <Text dimColor>Now processing:</Text>
          <Text>{showCurrent}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Elapsed: {elapsedStr}</Text>
      </Box>
    </Box>
  );
}
