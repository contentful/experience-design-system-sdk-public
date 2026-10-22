import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';
import { useTerminalWidth } from '@tui/use-terminal-width.js';
import { loadTokenRows } from './load.js';
import { TOKEN_REVIEW_CONTROLS, windowStart } from './logic.js';

interface TokenReviewScreenProps {
  tokensPath: string;
  onContinue: () => void;
  onQuit: () => void;
}

const VISIBLE_ROWS = 15;

/** Space left after the longest entry of the Token and Type columns. */
const COLUMN_GAP = 3;

/** Shows the generated design tokens before the import goes on. Read only: the tokens are pushed as they are. */
export function TokenReviewScreen({ tokensPath, onContinue, onQuit }: TokenReviewScreenProps): React.ReactElement {
  const loaded = useMemo(() => loadTokenRows(tokensPath), [tokensPath]);
  const rows = loaded.ok ? loaded.rows : [];
  const columns = useTerminalWidth();
  const [selected, setSelected] = useState(0);
  const [start, setStart] = useState(0);

  const move = (to: number): void => {
    const next = Math.max(0, Math.min(to, rows.length - 1));
    setSelected(next);
    setStart((current) => windowStart(next, current, VISIBLE_ROWS, rows.length));
  };

  useInput((_input, key) => {
    if (key.return) onContinue();
    else if (key.escape) onQuit();
    else if (key.upArrow) move(selected - 1);
    else if (key.downArrow) move(selected + 1);
    else if (key.pageUp) move(selected - VISIBLE_ROWS);
    else if (key.pageDown) move(selected + VISIBLE_ROWS);
  });

  // Columns are as wide as their longest entry, capped so the value always has room. The screen padding (2 each side) and
  // the pointer column come off the width; truncation keeps a row on one line.
  const innerWidth = Math.max(40, columns - 4 - 2);
  const pathWidth = Math.min(
    Math.max(10, ...rows.map((row) => row.path.length)) + COLUMN_GAP,
    Math.floor(innerWidth * 0.5),
  );
  const typeWidth = Math.max(4, ...rows.map((row) => row.type.length)) + COLUMN_GAP;
  const valueWidth = Math.max(10, innerWidth - pathWidth - typeWidth - 2);
  const clip = (text: string, width: number): string =>
    text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width);

  return (
    <Box flexDirection="column">
      <StepHeader step="review" />
      <Box flexDirection="column" paddingX={2} paddingBottom={1}>
        <Text bold>Review design tokens</Text>
        <Box marginTop={1}>
          {loaded.ok ? (
            <Text color={PALETTE.muted}>
              {rows.length} {rows.length === 1 ? 'token' : 'tokens'} generated from {tokensPath}
            </Text>
          ) : (
            <Text color={PALETTE.error}>Could not read the generated tokens: {loaded.message}</Text>
          )}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={PALETTE.muted} wrap="truncate-end">
            {'  '}
            {clip('Token name', pathWidth)} {clip('Type', typeWidth)} {clip('Value', valueWidth)}
          </Text>
          {rows.slice(start, start + VISIBLE_ROWS).map((row, offset) => {
            const active = start + offset === selected;
            return (
              <Text key={row.path} color={active ? PALETTE.accent : undefined} bold={active} wrap="truncate-end">
                {active ? '› ' : '  '}
                {clip(row.path, pathWidth)} {clip(row.type, typeWidth)} {clip(row.value, valueWidth)}
              </Text>
            );
          })}
        </Box>
        {rows.length > VISIBLE_ROWS && (
          <Box marginTop={1}>
            <Text color={PALETTE.muted}>
              {start + 1}-{Math.min(start + VISIBLE_ROWS, rows.length)} of {rows.length}
            </Text>
          </Box>
        )}
        <Box marginTop={1}>
          <ControlHints hints={TOKEN_REVIEW_CONTROLS} />
        </Box>
      </Box>
    </Box>
  );
}
