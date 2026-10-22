import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { assertDebugResumeStep, type DebugResumeState, type DebugResumeStep } from './debug-resume.js';

const OPTIONS: Array<{ step: DebugResumeStep; label: string }> = [
  { step: 'scope', label: 'Component selection — reuse extraction and component exploration' },
  { step: 'details', label: 'Property and slot reviews — rerun the three review passes' },
  { step: 'generation', label: 'Definition generation — retry held or incomplete components' },
  { step: 'tokens', label: 'Token mapping — reuse generated definitions' },
  { step: 'review', label: 'Final review — reuse definitions and token mappings' },
];

export function DebugResumeScreen({
  state,
  onChoose,
  onQuit,
}: {
  state: DebugResumeState;
  onChoose: (step: DebugResumeStep) => void;
  onQuit: () => void;
}): React.ReactElement {
  const [focus, setFocus] = useState(state.detailComplete ? 2 : state.decisions ? 1 : 0);
  const [error, setError] = useState('');
  useInput((_input, key) => {
    if (key.escape) onQuit();
    else if (key.upArrow) {
      setFocus((current) => Math.max(0, current - 1));
      setError('');
    } else if (key.downArrow) {
      setFocus((current) => Math.min(OPTIONS.length - 1, current + 1));
      setError('');
    } else if (key.return) {
      try {
        const step = OPTIONS[focus]!.step;
        assertDebugResumeStep(state, step);
        onChoose(step);
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : String(issue));
      }
    }
  });
  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold>Debug resume — {state.checkpoint.extraction.sessionId}</Text>
      <Text>Reusing the saved source snapshot and agent results. Choose where to restart.</Text>
      <Text color={PALETTE.muted}>Debug resumes save locally; credentials and push are skipped.</Text>
      <Box flexDirection="column">
        {OPTIONS.map((option, index) => (
          <Text key={option.step} color={index === focus ? PALETTE.accent : undefined}>
            {index === focus ? '❯' : ' '} {option.label}
          </Text>
        ))}
      </Box>
      {error ? <Text color={PALETTE.error}>{error}</Text> : null}
      <Text color={PALETTE.muted}>[↑/↓] Choose step [Enter] Resume [Esc] Back</Text>
    </Box>
  );
}
