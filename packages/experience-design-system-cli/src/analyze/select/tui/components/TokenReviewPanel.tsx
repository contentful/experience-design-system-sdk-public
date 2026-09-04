import React from 'react';
import { Box, Text } from 'ink';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { PALETTE } from '../theme.js';

export type TokenPropSuggestion = {
  propName: string;
  paths: string[];
  suggested: string[];
  allowed: string[];
};

export type TokenReviewToken = {
  path: string;
  kind: string;
};

/**
 * Design-token props on `entry` with a declared token kind. `paths` is the
 * full compatible token universe when a token catalog is available; `allowed`
 * remains the current subset.
 */
export function collectTokenSuggestions(
  entry: CDFComponentEntry,
  availableTokens: TokenReviewToken[] = [],
): TokenPropSuggestion[] {
  return Object.entries(entry.$properties)
    .filter(([, def]) => {
      const rawKind = (def as { '$token.kind'?: unknown })['$token.kind'];
      return (
        def.$type === 'token' &&
        def.$category === 'design' &&
        (typeof rawKind === 'string' || Array.isArray(rawKind))
      );
    })
    .map(([propName, def]) => {
      const persistedAllowed = [...(def['$token.allowed'] ?? [])];
      const rawKind = (def as { '$token.kind'?: unknown })['$token.kind'];
      const kinds = Array.isArray(rawKind)
        ? rawKind.filter((kind): kind is string => typeof kind === 'string')
        : typeof rawKind === 'string'
          ? rawKind
              .split(',')
              .map((kind) => kind.trim())
              .filter(Boolean)
          : [];
      const compatible = availableTokens
        .filter((token) => kinds.includes(token.kind))
        .map((token) => token.path);
      const compatiblePaths = new Set(compatible);
      const allowed =
        availableTokens.length > 0 ? persistedAllowed.filter((path) => compatiblePaths.has(path)) : persistedAllowed;
      const paths = availableTokens.length > 0 ? compatible : allowed;
      return { propName, paths, suggested: [...allowed], allowed };
    });
}

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
        borderColor={active ? PALETTE.inverse : undefined}
      >
        <Text bold dimColor={!active} wrap="truncate">
          {`TOKEN REVIEW — ${componentName} · ${current.propName} (edit allowed)`}
        </Text>
        <Text dimColor wrap="truncate">
          {`select which tokens are allowed (${rangeLabel})`}
        </Text>
        <Text> </Text>
        {current.paths.length === 0 && <Text dimColor>{'(no compatible tokens found for this token kind)'}</Text>}
        {visiblePaths.map((path, i) => {
          const pathIndex = scrollStart + i;
          const checked = editSelection.has(path);
          const focused = pathIndex === editCursor;
          return (
            <Box key={path}>
              <Text color={focused ? PALETTE.info : undefined} bold={focused} dimColor={!active} wrap="truncate">
                {`  [${checked ? 'x' : ' '}] ${path}`}
              </Text>
            </Box>
          );
        })}
        <Text> </Text>
        <Text dimColor wrap="truncate">{'[↑/↓] move  [Space] toggle'}</Text>
        <Text dimColor wrap="truncate">{'[Ctrl+S] save  [Esc] cancel'}</Text>
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
        const focused = i === selectedRow;
        return (
          <Box key={s.propName} flexDirection="column">
            <Box>
              <Text color={focused ? PALETTE.info : undefined} bold={focused} dimColor={!active}>
                {`${focused ? '▶' : ' '} ${s.propName}`}
              </Text>
            </Box>
            <Text dimColor>{`  suggested: ${s.suggested.join(', ')}`}</Text>
            <Text dimColor>{`  allowed: ${s.allowed.join(', ')}`}</Text>
          </Box>
        );
      })}
      <Text> </Text>
      <Text dimColor>{'[↑/↓] move  [Enter] edit allowed  [Esc] close'}</Text>
    </Box>
  );
}
