import type { LineageJumpable } from './hooks/useLineage.js';

type LineageInputKey = {
  upArrow: boolean;
  downArrow: boolean;
  tab: boolean;
  return: boolean;
};

export function handleLineageNavigation({
  key,
  cursor,
  jumpables,
  onCursorChange,
  onJump,
  onClose,
  allowTab,
}: {
  input?: string;
  key: LineageInputKey;
  cursor: number;
  jumpables: LineageJumpable[];
  onCursorChange: (update: number | ((current: number) => number)) => void;
  onJump: (name: string) => void;
  onClose: () => void;
  allowTab: boolean;
}): boolean {
  if (key.upArrow) {
    onCursorChange((current) => Math.max(0, current - 1));
    return true;
  }
  if (key.downArrow) {
    onCursorChange((current) => Math.min(Math.max(0, jumpables.length - 1), current + 1));
    return true;
  }
  if (allowTab && key.tab) {
    onCursorChange((current) => (jumpables.length === 0 ? 0 : (current + 1) % jumpables.length));
    return true;
  }
  if (key.return) {
    const target = jumpables[cursor];
    if (target && (target.entry.kind === 'ancestor' || target.entry.kind === 'descendant')) {
      onJump(target.entry.jumpTarget);
    }
    onClose();
    return true;
  }
  return false;
}
