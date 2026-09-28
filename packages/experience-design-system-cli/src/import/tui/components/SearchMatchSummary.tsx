import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { formatSearchMatchSummary } from '../sidebar-input.js';

export type SearchMatchSummaryProps = {
  open: boolean;
  query: string;
  matches: number;
  total: number;
  autocompleteCandidates: string[];
  hidden?: boolean;
  marginTop?: number;
};

export function SearchMatchSummary({
  open,
  query,
  matches,
  total,
  autocompleteCandidates,
  hidden = false,
  marginTop,
}: SearchMatchSummaryProps): React.ReactElement | null {
  if (hidden) return null;

  return (
    <>
      {open && (
        <Box marginTop={marginTop} flexDirection="column">
          <Text>
            {`/${query}`}
            <Text color={PALETTE.info}>{'▎'}</Text>
            {query && <Text dimColor>{formatSearchMatchSummary(matches, total)}</Text>}
            <Text dimColor>{'  · [Esc] leave'}</Text>
          </Text>
          {autocompleteCandidates.length > 1 && (
            <Text dimColor>{`  possibilities: ${autocompleteCandidates.join(' · ').slice(0, 120)}`}</Text>
          )}
        </Box>
      )}
      {!open && query && (
        <Box marginTop={marginTop}>
          <Text dimColor>{`/${query}${formatSearchMatchSummary(matches, total)} · [Esc] clear`}</Text>
        </Box>
      )}
    </>
  );
}
