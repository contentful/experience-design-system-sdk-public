import React from 'react';
import { Box, Text } from 'ink';
import type { EditorState } from '../state.js';

type JsonEditorProps = {
  editorState: EditorState;
  width: number;
  height: number;
};

/**
 * Pure render component — no input handling, no hooks.
 * All state lives in the reducer; all keys are handled by inputToAction.
 */
export function JsonEditor({ editorState, width, height }: JsonEditorProps): React.ReactElement {
  const { cursor, scrollRow, validationError } = editorState;
  const { lines, cursorRow, cursorCol } = cursor;

  const innerWidth = Math.max(1, width - 2);
  const visibleLines = lines.slice(scrollRow, scrollRow + height);

  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor="white">
      <Text bold>{'EDIT  [Ctrl+S save · Ctrl+Z undo · Esc discard]'}</Text>
      {visibleLines.map((line, displayRow) => {
        const actualRow = displayRow + scrollRow;
        const displayLine = line.slice(0, innerWidth);

        if (actualRow === cursorRow) {
          const before = displayLine.slice(0, cursorCol);
          const cursorChar = displayLine[cursorCol] ?? ' ';
          const after = displayLine.slice(cursorCol + 1);
          return (
            <Box key={actualRow}>
              <Text>{before}</Text>
              <Text inverse>{cursorChar}</Text>
              <Text>{after}</Text>
            </Box>
          );
        }
        return <Text key={actualRow}>{displayLine}</Text>;
      })}
      {validationError && <Text color="red">{'✗ ' + validationError}</Text>}
    </Box>
  );
}
