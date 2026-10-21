import React from 'react';
import figures from 'figures';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';

export type TokenPropSuggestion = {
  propName: string;
  paths: string[];
  suggested: string[];
  allowed: string[];
};

/**
 * Design-token props on `entry` with a declared token kind. `paths` is the
 * full compatible token universe when a token catalog is available; `allowed`
 * remains the current subset.
 */
export type TokenReviewPanelProps = {
  componentName: string;
  suggestions: TokenPropSuggestion[];
  selectedRow: number;
  editing: boolean;
  editCursor: number;
  editSelection: Set<string>;
  width: number;
  height: number;
  active: boolean;
};

export function TokenReviewPanel({
  componentName,
  suggestions,
  selectedRow,
  editing,
  editCursor,
  editSelection,
  width,
  height,
  active,
}: TokenReviewPanelProps): React.ReactElement {
  const current = suggestions[selectedRow];

  if (editing && current) {
    const visibleCount = Math.max(1, height - 6);
    const maxStart = Math.max(0, current.paths.length - visibleCount);
    const scrollStart = Math.max(0, Math.min(editCursor - Math.floor(visibleCount / 2), maxStart));
    const visiblePaths = current.paths.slice(scrollStart, scrollStart + visibleCount);
    const rangeLabel =
      current.paths.length === 0
        ? 'no compatible tokens'
        : `${scrollStart + 1}-${scrollStart + visiblePaths.length} of ${current.paths.length}`;
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height + 2}
        borderStyle="single"
        borderColor={active ? PALETTE.text : undefined}
      >
        <Text bold color={active ? undefined : PALETTE.muted} wrap="truncate">
          {`TOKEN REVIEW — ${componentName} · ${current.propName} (edit allowed)`}
        </Text>
        <Text color={PALETTE.muted} wrap="truncate">
          {`select which tokens are allowed (${rangeLabel})`}
        </Text>
        <Text> </Text>
        {current.paths.length === 0 && (
          <Text color={PALETTE.muted}>{'(no compatible tokens found for this token kind)'}</Text>
        )}
        {visiblePaths.map((path, i) => {
          const pathIndex = scrollStart + i;
          const checked = editSelection.has(path);
          const focused = pathIndex === editCursor;
          return (
            <Box key={path}>
              <Text
                color={focused ? PALETTE.accent : active ? undefined : PALETTE.muted}
                bold={focused}
                wrap="truncate"
              >
                {`  [${checked ? 'x' : ' '}] ${path}`}
              </Text>
            </Box>
          );
        })}
        <Text> </Text>
        <Text color={PALETTE.muted} wrap="truncate">
          {'[↑/↓] move  [Space] toggle'}
        </Text>
        <Text color={PALETTE.muted} wrap="truncate">
          {'[Ctrl+S] save  [Esc] cancel'}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height + 2}
      borderStyle="single"
      borderColor={active ? PALETTE.text : undefined}
    >
      <Text bold color={active ? undefined : PALETTE.muted}>{`TOKEN REVIEW — ${componentName}`}</Text>
      {suggestions.length === 0 && <Text color={PALETTE.muted}>{'(no token suggestions for this component)'}</Text>}
      {suggestions.map((s, i) => {
        const focused = i === selectedRow;
        return (
          <Box key={s.propName} flexDirection="column">
            <Box>
              <Text color={focused ? PALETTE.accent : active ? undefined : PALETTE.muted} bold={focused}>
                {`${focused ? figures.pointer : ' '} ${s.propName}`}
              </Text>
            </Box>
            <Text color={PALETTE.muted}>{`  suggested: ${s.suggested.join(', ')}`}</Text>
            <Text color={PALETTE.muted}>{`  allowed: ${s.allowed.join(', ')}`}</Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text>{'[↑/↓] move  [Enter] edit allowed  [Esc] close'}</Text>
    </Box>
  );
}
