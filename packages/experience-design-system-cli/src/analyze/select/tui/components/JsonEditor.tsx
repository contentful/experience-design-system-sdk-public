import React, { useState } from 'react';
import { PALETTE } from '../theme.js';
import { Box, Text } from 'ink';
import { useUndo } from '../hooks/useUndo.js';
import { useImmediateInput } from '../hooks/useImmediateInput.js';

type JsonEditorProps = {
  value: string;
  width: number;
  height: number;
  onSave: (value: string) => void;
  onDiscard: () => void;
};

type EditorCursor = {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
};

export function JsonEditor({ value, width, height, onSave, onDiscard }: JsonEditorProps): React.ReactElement {
  const undo = useUndo<EditorCursor>({
    lines: value.split('\n'),
    cursorRow: 0,
    cursorCol: 0,
  });

  const [scrollRow, setScrollRow] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { lines, cursorRow, cursorCol } = undo.current;
  const scrollCol = 0;

  // Sync scroll with cursor — pure derivation, no setState needed when within bounds
  let effectiveScrollRow = scrollRow;
  if (cursorRow < scrollRow) effectiveScrollRow = cursorRow;
  if (cursorRow >= scrollRow + height) effectiveScrollRow = cursorRow - height + 1;
  if (effectiveScrollRow !== scrollRow) setScrollRow(effectiveScrollRow);

  useImmediateInput((input, key) => {
    const currentLines = undo.current.lines;
    const currentRow = undo.current.cursorRow;
    const currentCol = undo.current.cursorCol;

    if (key.ctrl && input === 's') {
      const text = currentLines.join('\n');
      try {
        JSON.parse(text);
        setValidationError(null);
        onSave(text);
      } catch (e) {
        setValidationError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    if (key.escape) {
      onDiscard();
      return;
    }

    if (key.ctrl && input === 'z') {
      undo.undo();
      return;
    }

    let newLines = [...currentLines];
    let newRow = currentRow;
    let newCol = currentCol;

    if (key.return) {
      const before = newLines[currentRow]!.slice(0, currentCol);
      const after = newLines[currentRow]!.slice(currentCol);
      newLines = [...newLines.slice(0, currentRow), before, after, ...newLines.slice(currentRow + 1)];
      newRow = currentRow + 1;
      newCol = 0;
    } else if (key.backspace) {
      if (currentCol > 0) {
        newLines[currentRow] = newLines[currentRow]!.slice(0, currentCol - 1) + newLines[currentRow]!.slice(currentCol);
        newCol = currentCol - 1;
      } else if (currentRow > 0) {
        const prevLen = newLines[currentRow - 1]!.length;
        newLines[currentRow - 1] = newLines[currentRow - 1]! + newLines[currentRow]!;
        newLines = [...newLines.slice(0, currentRow), ...newLines.slice(currentRow + 1)];
        newRow = currentRow - 1;
        newCol = prevLen;
      }
    } else if (key.delete) {
      if (currentCol < newLines[currentRow]!.length) {
        newLines[currentRow] = newLines[currentRow]!.slice(0, currentCol) + newLines[currentRow]!.slice(currentCol + 1);
      } else if (currentRow < newLines.length - 1) {
        newLines[currentRow] = newLines[currentRow]! + newLines[currentRow + 1]!;
        newLines = [...newLines.slice(0, currentRow + 1), ...newLines.slice(currentRow + 2)];
      }
    } else if (key.leftArrow) {
      if (currentCol > 0) newCol = currentCol - 1;
      else if (currentRow > 0) {
        newRow = currentRow - 1;
        newCol = newLines[currentRow - 1]!.length;
      }
    } else if (key.rightArrow) {
      if (currentCol < newLines[currentRow]!.length) newCol = currentCol + 1;
      else if (currentRow < newLines.length - 1) {
        newRow = currentRow + 1;
        newCol = 0;
      }
    } else if (key.upArrow) {
      if (currentRow > 0) {
        newRow = currentRow - 1;
        newCol = Math.min(currentCol, newLines[currentRow - 1]!.length);
      }
    } else if (key.downArrow) {
      if (currentRow < newLines.length - 1) {
        newRow = currentRow + 1;
        newCol = Math.min(currentCol, newLines[currentRow + 1]!.length);
      }
    } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
      newLines[currentRow] =
        newLines[currentRow]!.slice(0, currentCol) + input + newLines[currentRow]!.slice(currentCol);
      newCol = currentCol + 1;
    } else {
      return;
    }

    undo.push({ lines: newLines, cursorRow: newRow, cursorCol: newCol });
  });

  const innerWidth = Math.max(1, width - 2);
  const visibleLines = lines.slice(effectiveScrollRow, effectiveScrollRow + height);

  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor={PALETTE.inverse}>
      <Text bold>{'EDIT [EDITING — Ctrl+S save · Esc discard]'}</Text>
      {visibleLines.map((line, displayRow) => {
        const actualRow = displayRow + effectiveScrollRow;
        const displayLine = line.slice(scrollCol, scrollCol + innerWidth);

        if (actualRow === cursorRow) {
          const beforeCursor = displayLine.slice(0, cursorCol - scrollCol);
          const cursorChar = displayLine[cursorCol - scrollCol] ?? ' ';
          const afterCursor = displayLine.slice(cursorCol - scrollCol + 1);
          return (
            <Box key={displayRow}>
              <Text>{beforeCursor}</Text>
              <Text inverse>{cursorChar}</Text>
              <Text>{afterCursor}</Text>
            </Box>
          );
        }

        return <Text key={displayRow}>{displayLine}</Text>;
      })}
      {validationError && <Text color={PALETTE.error}>{'✗ Invalid JSON: ' + validationError}</Text>}
    </Box>
  );
}
