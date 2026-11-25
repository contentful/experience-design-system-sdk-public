import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { useImmediateInput } from '../../07-scope-gate/sidebar/hooks/useImmediateInput.js';
import { resolveUserPath } from '../../../resolve-user-path.js';
import { useBlinkingCursor } from '../support/use-blinking-cursor.js';
import { PALETTE } from '@tui/theme.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { isClearKey } from '@tui/shared/components/ClearableTextInput.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';
import { cleanPathText, stripControlCharacters } from '@tui/shared/path-text.js';

export type PathPromptProps = {
  defaultPath: string;
  onSubmit: (path: string) => void;
  onCancel: () => void;
  label?: string;
  /** What is being saved, shown above the path, such as "Saving 42 design tokens." */
  summary?: string;
};

const PATH_PROMPT_CONTROLS = [
  { keys: 'Enter', label: 'Confirm' },
  { keys: 'Tab', label: 'Autocomplete' },
  { keys: 'Ctrl+D', label: 'Clear' },
  { keys: 'Esc', label: 'Cancel' },
] as const;

function commonPrefix(names: string[]): string {
  return names.reduce((prefix, name) => {
    let length = 0;
    while (length < prefix.length && prefix[length] === name[length]) length += 1;
    return prefix.slice(0, length);
  });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function autocompletePath(partial: string): string | null {
  const typed = cleanPathText(partial);
  if (!typed) return null;
  const endsAtFolder = typed.endsWith('/') || typed.endsWith(sep);
  const resolved = resolveUserPath(typed);
  const dir = endsAtFolder ? resolved : dirname(resolved);
  const base = endsAtFolder ? '' : basename(resolved);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const matches = entries.filter((entry) => entry.startsWith(base));
  if (matches.length === 0) return null;
  const completed = join(dir, commonPrefix(matches));
  if (matches.length === 1 && isDirectory(completed)) return completed + sep;
  return completed.length > join(dir, base).length ? completed : null;
}

export function PathPrompt({
  defaultPath,
  onSubmit,
  onCancel,
  label = 'Save to',
  summary,
}: PathPromptProps): React.ReactElement {
  const [input, setInput] = useState(() => cleanPathText(defaultPath));
  const cursorVisible = useBlinkingCursor();

  useImmediateInput((rawInput, key) => {
    if (key.return) {
      if (cleanPathText(input) !== '') onSubmit(resolveUserPath(input));
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      const completed = autocompletePath(input);
      if (completed) setInput(completed);
      return;
    }
    if (isClearKey(rawInput, key)) {
      setInput('');
      return;
    }
    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
      return;
    }
    if (rawInput && !key.ctrl && !key.meta) {
      setInput((v) => v + stripControlCharacters(rawInput));
    }
  });

  const cursor = cursorVisible ? '█' : ' ';

  return (
    <Box flexDirection="column">
      <StepHeader step="push" />
      <Box flexDirection="column" gap={1} paddingX={2} paddingBottom={1}>
        {summary && <Text color={PALETTE.muted}>{summary}</Text>}
        <Box gap={1}>
          <Text color={PALETTE.accent}>?</Text>
          <Text bold>{label}:</Text>
          <Text>{input}</Text>
          <Text>{cursor}</Text>
        </Box>
        <ControlHints hints={PATH_PROMPT_CONTROLS} />
      </Box>
    </Box>
  );
}
