import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { ClearableTextInput } from './ClearableTextInput.js';
import { ControlHints } from './ControlHints.js';
import { MenuScreen, type MenuItem } from './MenuScreen.js';
import { StepHeader } from './StepHeader.js';

type PathCheck = { ok: true; path: string } | { ok: false; error: string; resolvedPath?: string };

interface PathStepScreenProps {
  title: string;
  subtitle: string;
  /** The label of the read-only value and of the input, such as "Project path". */
  label: string;
  initialPath?: string;
  /** Trims the typed value; null when nothing was entered. */
  toPath: (value: string) => string | null;
  /** Runs when Continue is chosen. Its path is handed on; its error is shown under the path. */
  check: (path: string) => PathCheck;
  onContinue: (path: string) => void;
  onBack: () => void;
}

type Choice = 'continue' | 'edit' | 'back';

const MENU: readonly MenuItem<Choice>[] = [
  { choice: 'continue', label: 'Continue', description: 'Use this path and go on' },
  { choice: 'edit', label: 'Edit', description: 'Change the path' },
  { choice: 'back', label: 'Back', description: 'Go back' },
];

/**
 * A step that asks for one path. A path that is already known opens read-only with the menu above it, like the
 * credentials step; with none yet it opens straight in the input. `Edit` opens the input and Enter returns to the menu.
 */
export function PathStepScreen({
  title,
  subtitle,
  label,
  initialPath = '',
  toPath,
  check,
  onContinue,
  onBack,
}: PathStepScreenProps): React.ReactElement {
  const [value, setValue] = useState(initialPath);
  const [savedValue, setSavedValue] = useState(toPath(initialPath) === null ? '' : initialPath);
  const [editing, setEditing] = useState(toPath(initialPath) === null);
  const [failure, setFailure] = useState<{ error: string; resolvedPath?: string } | null>(null);

  // Esc closes the input and restores the last path; with no path to return to it leaves the step.
  useInput(
    (_input, key) => {
      if (!key.escape) return;
      if (savedValue === '') {
        onBack();
        return;
      }
      setValue(savedValue);
      setFailure(null);
      setEditing(false);
    },
    { isActive: editing },
  );

  const choose = (choice: Choice): void => {
    if (choice === 'edit') {
      setFailure(null);
      setEditing(true);
      return;
    }
    if (choice === 'back') {
      onBack();
      return;
    }
    const path = toPath(value);
    if (path === null) return;
    const result = check(path);
    if (result.ok) onContinue(result.path);
    else setFailure({ error: result.error, resolvedPath: result.resolvedPath });
  };

  const submit = (typed: string): void => {
    if (toPath(typed) === null) {
      setFailure({ error: `Enter the ${label.toLowerCase()}.` });
      return;
    }
    setSavedValue(typed);
    setEditing(false);
  };

  const failureLines = failure && (
    <>
      <Text> </Text>
      <Text color={PALETTE.error}>✗ {failure.error}</Text>
      {failure.resolvedPath && <Text color={PALETTE.muted}> Resolved to: {failure.resolvedPath}</Text>}
    </>
  );

  if (!editing) {
    return (
      <MenuScreen
        title={title}
        subtitle={subtitle}
        menu={MENU}
        rows={[{ label, value: savedValue }]}
        onChoose={choose}
        onEscape={onBack}
      >
        {failureLines}
      </MenuScreen>
    );
  }

  return (
    <Box flexDirection="column">
      <StepHeader step="setup" />
      <Box flexDirection="column" paddingX={2} paddingBottom={1}>
        <Text bold>{title}</Text>
        <Text> </Text>
        <Text color={PALETTE.muted}>{subtitle}</Text>
        <Text> </Text>
        <Box gap={1}>
          <Text color={PALETTE.accent}>?</Text>
          <Text>{label}:</Text>
          <ClearableTextInput
            value={value}
            onChange={(next) => {
              setValue(next);
              setFailure(null);
            }}
            onSubmit={submit}
          />
        </Box>
        {failureLines}
        <Text> </Text>
        <ControlHints
          hints={[
            { keys: '⏎', label: 'done' },
            { keys: 'Ctrl+D', label: 'clear' },
            { keys: 'Esc', label: savedValue === '' ? 'back' : 'cancel edit' },
          ]}
        />
      </Box>
    </Box>
  );
}
