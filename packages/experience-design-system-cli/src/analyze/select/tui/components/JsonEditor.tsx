import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useUndo } from '../hooks/useUndo.js';
import { useImmediateInput } from '../hooks/useImmediateInput.js';

type JsonEditorProps = {
  value: string;
  width: number;
  height: number;
  // Called with the final JSON string only on Ctrl+S (not on every keystroke)
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
  const [scrollCol] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { lines, cursorRow, cursorCol } = undo.current;

  // Keep scroll in sync with cursor
  useEffect(() => {
    if (cursorRow < scrollRow) setScrollRow(cursorRow);
    if (cursorRow >= scrollRow + height) setScrollRow(cursorRow - height + 1);
  }, [cursorRow, scrollRow, height]);

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
      const before = newLines[currentRow].slice(0, currentCol);
      const after = newLines[currentRow].slice(currentCol);
      newLines = [...newLines.slice(0, currentRow), before, after, ...newLines.slice(currentRow + 1)];
      newRow = currentRow + 1;
      newCol = 0;
    } else if (key.backspace || key.delete) {
      if (key.backspace) {
        if (currentCol > 0) {
          newLines[currentRow] = newLines[currentRow].slice(0, currentCol - 1) + newLines[currentRow].slice(currentCol);
          newCol = currentCol - 1;
        } else if (currentRow > 0) {
          const prevLen = newLines[currentRow - 1].length;
          newLines[currentRow - 1] = newLines[currentRow - 1] + newLines[currentRow];
          newLines = [...newLines.slice(0, currentRow), ...newLines.slice(currentRow + 1)];
          newRow = currentRow - 1;
          newCol = prevLen;
        }
      } else {
        if (currentCol < newLines[currentRow].length) {
          newLines[currentRow] = newLines[currentRow].slice(0, currentCol) + newLines[currentRow].slice(currentCol + 1);
        } else if (currentRow < newLines.length - 1) {
          newLines[currentRow] = newLines[currentRow] + newLines[currentRow + 1];
          newLines = [...newLines.slice(0, currentRow + 1), ...newLines.slice(currentRow + 2)];
        }
      }
    } else if (key.leftArrow) {
      if (currentCol > 0) {
        newCol = currentCol - 1;
      } else if (currentRow > 0) {
        newRow = currentRow - 1;
        newCol = newLines[currentRow - 1].length;
      }
    } else if (key.rightArrow) {
      if (currentCol < newLines[currentRow].length) {
        newCol = currentCol + 1;
      } else if (currentRow < newLines.length - 1) {
        newRow = currentRow + 1;
        newCol = 0;
      }
    } else if (key.upArrow) {
      if (currentRow > 0) {
        newRow = currentRow - 1;
        newCol = Math.min(currentCol, newLines[newRow].length);
      }
    } else if (key.downArrow) {
      if (currentRow < newLines.length - 1) {
        newRow = currentRow + 1;
        newCol = Math.min(currentCol, newLines[newRow].length);
      }
    } else if (input === '\x1b[H' || input === '\x1b[1~') {
      newCol = 0;
    } else if (input === '\x1b[F' || input === '\x1b[4~') {
      newCol = newLines[currentRow].length;
    } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
      newLines[currentRow] = newLines[currentRow].slice(0, currentCol) + input + newLines[currentRow].slice(currentCol);
      newCol = currentCol + 1;
    } else {
      return;
    }

    undo.push({ lines: newLines, cursorRow: newRow, cursorCol: newCol });
    // No onChange call here — state stays inside JsonEditor until Ctrl+S
  });

  const innerWidth = Math.max(1, width - 2);
  const visibleLines = lines.slice(scrollRow, scrollRow + height);

  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor="white">
      <Text bold>{'EDIT  [Ctrl+S save · Ctrl+Z undo · Esc discard]'}</Text>
      {visibleLines.map((line, displayRow) => {
        const actualRow = displayRow + scrollRow;
        const displayLine = line.slice(scrollCol, scrollCol + innerWidth);

        if (actualRow === cursorRow) {
          const beforeCursor = displayLine.slice(0, cursorCol - scrollCol);
          const cursorChar = displayLine[cursorCol - scrollCol] ?? ' ';
          const afterCursor = displayLine.slice(cursorCol - scrollCol + 1);
          return (
            <Box key={actualRow}>
              <Text>{beforeCursor}</Text>
              <Text inverse>{cursorChar}</Text>
              <Text>{afterCursor}</Text>
            </Box>
          );
        }
        return <Text key={actualRow}>{displayLine}</Text>;
      })}
      {validationError && <Text color="red">{'✗ Invalid JSON: ' + validationError}</Text>}
    </Box>
  );
}
