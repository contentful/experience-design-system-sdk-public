import { Box } from 'ink';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { legendEntry } from './LegendEntry.js';

export function CompactControlBar({ hasGroupRoots, searchActive }: { hasGroupRoots: boolean; searchActive: boolean }) {
  return (
    <Box borderStyle="single" borderColor={PALETTE.border} paddingX={1} marginTop={1} flexWrap="wrap" columnGap={2}>
      {legendEntry('[↑/↓]', 'move')}
      {legendEntry('[a/r]', 'accept/reject')}
      {legendEntry('[f]', 'continue/finalize')}
      {hasGroupRoots && legendEntry('[space/E/C]', 'expand/collapse')}
      {legendEntry('[/]', 'search', searchActive)}
      {legendEntry('[h]', 'help')}
      {legendEntry('[q]', 'quit')}
    </Box>
  );
}
