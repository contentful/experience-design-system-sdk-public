import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../analyze/select/tui/hooks/useImmediateInput.js';

export type SaveConflictGateProps = {
  path: string;
  onOverwrite: () => void;
  onNew: () => void;
  onCancel: () => void;
};

type Option = 'overwrite' | 'new' | 'cancel';

const OPTIONS: { key: Option; label: string; description: string }[] = [
  { key: 'overwrite', label: 'overwrite', description: 'Replace existing files at this path.' },
  { key: 'new', label: 'new', description: 'Write to a timestamped subdirectory.' },
  { key: 'cancel', label: 'cancel', description: 'Go back and pick a different path.' },
];

export function SaveConflictGate({ path, onOverwrite, onNew, onCancel }: SaveConflictGateProps): React.ReactElement {
  // Default cursor on "new" (index 1) — the safer non-destructive choice.
  const [focusIdx, setFocusIdx] = useState(1);

  const fire = (opt: Option): void => {
    if (opt === 'overwrite') onOverwrite();
    else if (opt === 'new') onNew();
    else onCancel();
  };

  useImmediateInput((rawInput, key) => {
    if (rawInput === 'o') {
      fire('overwrite');
      return;
    }
    if (rawInput === 'n') {
      fire('new');
      return;
    }
    if (rawInput === 'c') {
      fire('cancel');
      return;
    }
    if (key.upArrow) {
      setFocusIdx((i) => (i - 1 + OPTIONS.length) % OPTIONS.length);
      return;
    }
    if (key.downArrow) {
      setFocusIdx((i) => (i + 1) % OPTIONS.length);
      return;
    }
    if (key.return) {
      fire(OPTIONS[focusIdx]!.key);
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
  });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold color="yellow">A prior export exists at:</Text>
      <Text>{path}</Text>
      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((opt, i) => {
          const focused = i === focusIdx;
          const shortcut = opt.label[0]!;
          return (
            <Box key={opt.key} gap={1}>
              <Text color={focused ? 'cyan' : undefined}>{focused ? '❯' : ' '}</Text>
              <Text color={focused ? 'cyan' : undefined}>
                [{shortcut}]{opt.label.slice(1)}
              </Text>
              <Text dimColor>— {opt.description}</Text>
            </Box>
          );
        })}
      </Box>
      <Box gap={3} marginTop={1}>
        <Text dimColor>[o/n/c] Shortcut</Text>
        <Text dimColor>[↑/↓ + Enter] Navigate</Text>
        <Text dimColor>[Esc] Cancel</Text>
      </Box>
    </Box>
  );
}
