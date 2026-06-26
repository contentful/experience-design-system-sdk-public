import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

export type PushDecisionChoice = 'both' | 'push-only' | 'save-only';

type PushDecisionGateStepProps = {
  summary: string;
  context: string;
  fileList: string;
  onChoice: (choice: PushDecisionChoice) => void;
  onQuit: () => void;
};

const OPTIONS: ReadonlyArray<{ value: PushDecisionChoice; label: string; shortcut: string }> = [
  { value: 'both', label: 'Save AND push', shortcut: 'b' },
  { value: 'push-only', label: 'Push only', shortcut: 'p' },
  { value: 'save-only', label: 'Save only', shortcut: 's' },
];

export function PushDecisionGateStep({
  summary,
  context,
  onChoice,
  onQuit,
}: PushDecisionGateStepProps): React.ReactElement {
  const [cursor, setCursor] = useState(0);

  useImmediateInput((input, key) => {
    if (key.return) {
      onChoice(OPTIONS[cursor]!.value);
      return;
    }
    if (input === 'b') {
      onChoice('both');
      return;
    }
    if (input === 'p') {
      onChoice('push-only');
      return;
    }
    if (input === 's') {
      onChoice('save-only');
      return;
    }
    if (input === 'j' || key.downArrow) {
      setCursor((c) => Math.min(OPTIONS.length - 1, c + 1));
      return;
    }
    if (input === 'k' || key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (input === 'q' || key.escape) {
      onQuit();
      return;
    }
  });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text color="green">✓ Generation complete</Text>
      <Text dimColor>{summary}</Text>

      <Box marginTop={1}>
        <Text>{context}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((opt, i) => {
          const selected = i === cursor;
          return (
            <Text key={opt.value} color={selected ? 'cyan' : undefined}>
              {selected ? '›' : ' '} [{opt.shortcut}] {opt.label}
            </Text>
          );
        })}
      </Box>

      <Box gap={3} marginTop={1}>
        <Text dimColor>[Enter] Confirm</Text>
        <Text dimColor>[j/k] Move</Text>
        <Text dimColor>[q] Quit</Text>
      </Box>
    </Box>
  );
}
