import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { statSync } from 'node:fs';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import { normalizePath } from '../../path-utils.js';

type TokenInputStepProps = {
  onConfirm: (rawTokensPath: string) => void;
  onSkip: () => void;
  onQuit: () => void;
};

export function TokenInputStep({ onConfirm, onSkip, onQuit }: TokenInputStepProps): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedPath, setResolvedPath] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setCursorVisible((v) => !v), 500);
    return () => clearInterval(interval);
  }, []);

  useImmediateInput((input, key) => {
    if (key.return) {
      const trimmed = inputValue.trim();
      if (!trimmed) {
        onSkip();
        return;
      }
      const normalized = normalizePath(trimmed);
      let stat;
      try {
        stat = statSync(normalized);
      } catch {
        setError(`Path not found: ${normalized}`);
        setResolvedPath(normalized);
        return;
      }
      if (stat.isDirectory()) {
        setError(`That's a directory — provide a path to a token file (e.g. tokens.json), not a folder.`);
        setResolvedPath(normalized);
        return;
      }
      if (!stat.isFile()) {
        setError(`Not a regular file: ${normalized}`);
        setResolvedPath(normalized);
        return;
      }
      setError(null);
      setResolvedPath(normalized);
      onConfirm(normalized);
      return;
    }
    if (input === 's') {
      onSkip();
      return;
    }
    if (key.escape || input === 'q') {
      onQuit();
      return;
    }
    if (key.backspace || key.delete) {
      setInputValue((v) => v.slice(0, -1));
      setError(null);
      setResolvedPath(null);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setInputValue((v) => v + input);
      setError(null);
      setResolvedPath(null);
    }
  });

  const displayValue = inputValue + (cursorVisible ? '█' : ' ');

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold>Design tokens</Text>
      <Text dimColor>
        Point me to your raw token file (e.g. ~/design-tokens/tokens.json). You can use ~, relative, or absolute paths.
        Claude will map it to DTCG format.
      </Text>

      <Box flexDirection="column" marginTop={1} gap={0}>
        <Box gap={1}>
          <Text color="cyan">?</Text>
          <Text>Token path (file or directory):</Text>
          <Text>{displayValue}</Text>
        </Box>
        {resolvedPath && resolvedPath !== inputValue.trim() && !error && (
          <Box marginLeft={2}>
            <Text dimColor>→ {resolvedPath}</Text>
          </Box>
        )}
        {error && (
          <Box marginTop={0} flexDirection="column">
            <Text color="red">✗ {error}</Text>
            {resolvedPath && <Text dimColor> Resolved to: {resolvedPath}</Text>}
          </Box>
        )}
      </Box>

      <Box gap={3} marginTop={1}>
        <Text dimColor>[Enter] Confirm path</Text>
        <Text dimColor>[s] Skip tokens</Text>
        <Text dimColor>[q] Quit</Text>
      </Box>
    </Box>
  );
}
