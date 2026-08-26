import React from 'react';
import { Box, Text } from 'ink';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { PALETTE } from '../theme.js';

export type TokenPropSuggestion = {
  propName: string;
  sets: string[];
  allowed: string[];
};

/**
 * Design-token props on `entry` that carry a $token.sets suggestion to review.
 * A prop with cdf_type 'token' but no $token.sets yet (map tokens hasn't run,
 * or found nothing to suggest) is excluded — there is nothing to review.
 */
export function collectTokenSuggestions(entry: CDFComponentEntry): TokenPropSuggestion[] {
  return Object.entries(entry.$properties)
    .filter(([, def]) => def.$type === 'token' && def.$category === 'design' && (def['$token.sets']?.length ?? 0) > 0)
    .map(([propName, def]) => ({
      propName,
      sets: def['$token.sets'] ?? [],
      allowed: def['$token.allowed'] ?? [],
    }));
}

export type TokenReviewDecision = 'pending' | 'accepted';

export type TokenReviewPanelProps = {
  componentName: string;
  suggestions: TokenPropSuggestion[];
  decisions: Record<string, TokenReviewDecision>;
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
  decisions,
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
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height + 2}
        borderStyle="single"
        borderColor={active ? PALETTE.inverse : undefined}
      >
        <Text bold dimColor={!active}>{`TOKEN REVIEW — ${componentName} · ${current.propName} (edit allowed)`}</Text>
        <Text dimColor>{'restriction must come from $token.sets — select which paths are allowed'}</Text>
        <Text> </Text>
        {current.sets.map((path, i) => {
          const checked = editSelection.has(path);
          const focused = i === editCursor;
          return (
            <Box key={path}>
              <Text color={focused ? PALETTE.info : undefined} bold={focused} dimColor={!active}>
                {`  [${checked ? 'x' : ' '}] ${path}`}
              </Text>
            </Box>
          );
        })}
        <Text> </Text>
        <Text dimColor>{'[↑/↓] move  [Space] toggle  [Ctrl+S] save  [Esc] cancel'}</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height + 2}
      borderStyle="single"
      borderColor={active ? PALETTE.inverse : undefined}
    >
      <Text bold dimColor={!active}>{`TOKEN REVIEW — ${componentName}`}</Text>
      {suggestions.length === 0 && <Text dimColor>{'(no token suggestions for this component)'}</Text>}
      {suggestions.map((s, i) => {
        const decision = decisions[s.propName] ?? 'pending';
        const focused = i === selectedRow;
        return (
          <Box key={s.propName} flexDirection="column">
            <Box>
              <Text color={focused ? PALETTE.info : undefined} bold={focused} dimColor={!active}>
                {`${decision === 'accepted' ? '✓' : '○'} ${s.propName}`}
              </Text>
            </Box>
            <Text dimColor>{`  set: ${s.sets.join(', ')}`}</Text>
            <Text dimColor>{`  allowed: ${s.allowed.length > 0 ? s.allowed.join(', ') : '(none)'}`}</Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text dimColor>{'[↑/↓] move  [a] accept  [x] dismiss  [Enter] edit allowed  [Esc] close'}</Text>
    </Box>
  );
}
