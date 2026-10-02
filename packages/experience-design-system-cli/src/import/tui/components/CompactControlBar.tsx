import { Box } from 'ink';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { legendEntry } from './LegendEntry.js';

export function CompactControlBar({
  hasGroupRoots,
  searchActive,
  showJson = false,
  tokenReviewAvailable = false,
}: {
  hasGroupRoots: boolean;
  searchActive: boolean;
  showJson?: boolean;
  tokenReviewAvailable?: boolean;
}) {
  return (
    <Box borderStyle="single" borderColor={PALETTE.border} paddingX={1} marginTop={1} flexWrap="wrap" columnGap={2}>
      {legendEntry('[↑/↓]', 'move')}
      {legendEntry('[a/r]', 'accept/reject')}
      {legendEntry('[A]', 'accept all')}
      {hasGroupRoots && legendEntry('[space/E/C]', 'expand/collapse')}
      {legendEntry('[L]', 'flat')}
      {legendEntry('[i]', 'focus lineage')}
      {legendEntry('[w]', 'only breaking')}
      {legendEntry('[o]', 'only cycles')}
      {legendEntry('[c]', 'cycle list')}
      {legendEntry('[b]', 'breaking changes')}
      {legendEntry('[/]', 'search', searchActive)}
      {legendEntry('[f]', 'continue/finalize')}
      {legendEntry('[h]', 'help')}
      {legendEntry('[J]', showJson ? 'hide JSON' : 'show JSON')}
      {tokenReviewAvailable && legendEntry('[t]', 'token review')}
      {legendEntry('[Ctrl+Z/Y/R]', 'undo/redo/reload')}
      {legendEntry('[q]', 'quit')}
    </Box>
  );
}
