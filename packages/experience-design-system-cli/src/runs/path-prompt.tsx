import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { readdirSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { useImmediateInput } from '../analyze/select/tui/hooks/useImmediateInput.js';
import { normalizePath } from '../import/path-utils.js';

export type PathPromptProps = {
  defaultPath: string;
  onSubmit: (path: string) => void;
  onCancel: () => void;
  label?: string;
};

function autocomplete(partial: string): string | null {
  if (!partial) return null;
  const normalized = normalizePath(partial);
  const dir = dirname(normalized);
  const base = basename(normalized);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const matches = entries.filter((e) => e.startsWith(base));
  if (matches.length === 0) return null;
  if (matches.length === 1) return join(dir, matches[0]!);
  // Common prefix
  let prefix = matches[0]!;
  for (const m of matches) {
    while (!m.startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (!prefix) break;
  }
  return prefix.length > base.length ? join(dir, prefix) : null;
}

export function PathPrompt({
  defaultPath,
  onSubmit,
  onCancel,
  label = 'Save to',
}: PathPromptProps): React.ReactElement {
  const [input, setInput] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setCursorVisible((v) => !v), 500);
    return () => clearInterval(interval);
  }, []);

  useImmediateInput((rawInput, key) => {
    if (key.return) {
      const trimmed = input.trim();
      onSubmit(trimmed === '' ? defaultPath : normalizePath(trimmed));
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      const target = input.trim() || defaultPath;
      const completed = autocomplete(target);
      if (completed) setInput(completed);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
      return;
    }
    if (rawInput && !key.ctrl && !key.meta) {
      setInput((v) => v + rawInput);
    }
  });

  const shown = input || defaultPath;
  const isPlaceholder = input === '';
  const cursor = cursorVisible ? '█' : ' ';

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Box gap={1}>
        <Text color="cyan">?</Text>
        <Text bold>{label}:</Text>
        <Text dimColor={isPlaceholder}>{shown}</Text>
        <Text>{cursor}</Text>
      </Box>
      <Box gap={3}>
        <Text dimColor>[Enter] Confirm</Text>
        <Text dimColor>[Tab] Autocomplete</Text>
        <Text dimColor>[Esc] Cancel</Text>
      </Box>
    </Box>
  );
}
