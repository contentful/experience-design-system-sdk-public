import React, { useState } from 'react';
import { Box, Text } from 'ink';
import type { ValidationDiagnostic } from '../validators/format-errors.js';
import { TopBar } from '../../../analyze/select/tui/components/TopBar.js';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import { useRawMode } from '../../../analyze/select/tui/hooks/useRawMode.js';

export type ValidateViewEntry = {
  filePath: string;
  format: 'CDF v1' | 'DTCG';
  valid: boolean;
  summary?: string;
  diagnostics: ValidationDiagnostic[];
};

type ValidateViewProps = {
  results: ValidateViewEntry[];
  onExit: () => void;
};

export function ValidateView({ results, onExit }: ValidateViewProps): React.ReactElement {
  useRawMode();
  const [scrollOffset, setScrollOffset] = useState(0);
  const allValid = results.every((r) => r.valid);

  useImmediateInput((input, key) => {
    if (input === 'q' || key.return) {
      onExit();
      return;
    }
    if (key.upArrow || input === 'k') {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow || input === 'j') {
      setScrollOffset((o) => o + 1);
    } else if (input === 'g') {
      setScrollOffset(0);
    } else if (input === 'G') {
      setScrollOffset(100);
    }
  });

  const invalidResults = results.filter((r) => !r.valid);

  return (
    <Box flexDirection="column">
      <TopBar
        subcommand="validate"
        hints={[
          { key: '?', label: 'help' },
          { key: 'q', label: 'quit' },
        ]}
      />
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {results.map((r) => {
          const summaryText = r.summary || (r.valid ? 'valid' : (r.diagnostics[0]?.message ?? 'invalid'));
          return (
            <Box key={r.filePath}>
              <Text color={r.valid ? 'green' : 'red'}>{r.valid ? '✓' : '✗'}</Text>
              <Text>{' ' + r.filePath.split('/').pop()}</Text>
              <Text dimColor>{'   ' + r.format + '   '}</Text>
              <Text color={r.valid ? 'green' : 'red'}>{summaryText}</Text>
            </Box>
          );
        })}
        {invalidResults.length > 0 && (
          <>
            {invalidResults.map((r) => (
              <Box key={r.filePath} flexDirection="column">
                <Text> </Text>
                <Text dimColor>{'─'.repeat(70)}</Text>
                <Text bold>{r.filePath.split('/').pop() + ' errors'}</Text>
                <Text dimColor>{'─'.repeat(70)}</Text>
                <Text> </Text>
                {r.diagnostics.slice(scrollOffset).map((d, i) => (
                  <Box key={i}>
                    <Text color="red">{'  ✗ ' + d.path + ': ' + d.message}</Text>
                  </Box>
                ))}
              </Box>
            ))}
          </>
        )}
      </Box>
      <Box borderStyle="single" paddingX={1} justifyContent="space-between">
        <Text dimColor>
          {allValid
            ? 'All files valid'
            : invalidResults.length + ' file' + (invalidResults.length === 1 ? '' : 's') + ' invalid'}
        </Text>
        <Text dimColor>{allValid ? '[q]' : 'scroll ↑↓ [q]'}</Text>
      </Box>
    </Box>
  );
}
