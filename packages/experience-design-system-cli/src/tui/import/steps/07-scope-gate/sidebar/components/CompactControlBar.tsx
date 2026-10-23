import { ControlHints } from '@tui/shared/components/ControlHints.js';

export function CompactControlBar({ hasGroupRoots, searchActive }: { hasGroupRoots: boolean; searchActive: boolean }) {
  return (
    <ControlHints
      hints={[
        { keys: '↑/↓', label: 'move' },
        { keys: 'a/r', label: 'accept/reject' },
        { keys: 'f', label: 'continue/finalize' },
        ...(hasGroupRoots ? [{ keys: 'space/E/C', label: 'expand/collapse' }] : []),
        { keys: '/', label: 'search', active: searchActive },
        { keys: 'h', label: 'help' },
        { keys: 'q', label: 'quit' },
      ]}
    />
  );
}
