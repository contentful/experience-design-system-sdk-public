import React, { useState } from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

export type PushDecisionChoice = 'both' | 'push-only' | 'save-only';

type PushDecisionGateStepProps = {
  summary: string;
  context: string;
  fileList: string;
  onChoice: (choice: PushDecisionChoice) => void;
  onQuit: () => void;
  /**
   * Skip-credentials spec — Task 3. When the operator advanced past the
   * credentials screen via the skip path, push options are not actually
   * usable (we never validated a token). Render all three rows for visual
   * continuity but disable "Save AND push" and "Push only", with the
   * `(unavailable — credentials skipped)` suffix.
   */
  pushDisabled?: boolean;
};

const OPTIONS: ReadonlyArray<{ value: PushDecisionChoice; label: string; shortcut: string }> = [
  { value: 'both', label: 'Save AND push', shortcut: 'b' },
  { value: 'push-only', label: 'Push only', shortcut: 'p' },
  { value: 'save-only', label: 'Save only', shortcut: 's' },
];

const SAVE_ONLY_INDEX = OPTIONS.findIndex((o) => o.value === 'save-only');

export function PushDecisionGateStep({
  summary,
  context,
  onChoice,
  onQuit,
  pushDisabled = false,
}: PushDecisionGateStepProps): React.ReactElement {
  // When push is disabled, the cursor defaults to "Save only" (the only
  // selectable row). When push is enabled, "Save AND push" is the default —
  // matches the existing scope-gate UX.
  const [cursor, setCursor] = useState(pushDisabled ? SAVE_ONLY_INDEX : 0);

  function isSelectable(index: number): boolean {
    if (!pushDisabled) return true;
    return OPTIONS[index]!.value === 'save-only';
  }

  useImmediateInput((input, key) => {
    if (key.return) {
      if (!isSelectable(cursor)) return;
      onChoice(OPTIONS[cursor]!.value);
      return;
    }
    if (input === 'b') {
      if (pushDisabled) return;
      onChoice('both');
      return;
    }
    if (input === 'p') {
      if (pushDisabled) return;
      onChoice('push-only');
      return;
    }
    if (input === 's') {
      onChoice('save-only');
      return;
    }
    if (input === 'j' || key.downArrow) {
      setCursor((c) => {
        // Walk forward to the next selectable row. If none, stay put.
        for (let i = c + 1; i < OPTIONS.length; i++) {
          if (isSelectable(i)) return i;
        }
        return c;
      });
      return;
    }
    if (input === 'k' || key.upArrow) {
      setCursor((c) => {
        for (let i = c - 1; i >= 0; i--) {
          if (isSelectable(i)) return i;
        }
        return c;
      });
      return;
    }
    if (input === 'q' || key.escape) {
      onQuit();
      return;
    }
  });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text color={PALETTE.success}>✓ Generation complete</Text>
      <Text dimColor>{summary}</Text>

      <Box marginTop={1}>
        <Text>{context}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((opt, i) => {
          const selected = i === cursor;
          const disabled = pushDisabled && opt.value !== 'save-only';
          const suffix = disabled ? ' (unavailable — credentials skipped)' : '';
          return (
            <Text key={opt.value} color={selected ? PALETTE.info : undefined} dimColor={disabled}>
              {selected ? '›' : ' '} [{opt.shortcut}] {opt.label}
              {suffix}
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
