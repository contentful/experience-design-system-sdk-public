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
            {query && <Text color={PALETTE.muted}>{formatSearchMatchSummary(matches, total)}</Text>}
            <Text>{'  · [Esc] leave'}</Text>
          </Text>
          {autocompleteCandidates.length > 1 && (
            <Text color={PALETTE.muted}>{`  possibilities: ${autocompleteCandidates.join(' · ').slice(0, 120)}`}</Text>
          )}
        </Box>
      )}
      {!open && query && (
        <Box marginTop={marginTop}>
          <Text>{`/${query}${formatSearchMatchSummary(matches, total)} · [Esc] clear`}</Text>
        </Box>
      )}
    </>
  );
}
