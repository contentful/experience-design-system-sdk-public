import { useCallback, useState } from 'react';

/**
 * T10 (parity plan §3) — shared open/close primitive for the TUI's overlay
 * panels. Every step-level panel in Generate-Review and Scope-Gate follows the
 * same convention:
 *
 *   - A single toggle key (e.g. `[c]` cycles, `[d]` removed, `[l]` lineage)
 *     both opens and closes the panel.
 *   - `Esc` unconditionally closes the panel while it is open.
 *   - Opens are caller-owned (each panel has its own gating conditions —
 *     "sidebar-focused AND slotCycles.length > 0" for `[c]`, "live-preview AND
 *     removedComponents.length > 0" for `[d]`, etc.). The hook only
 *     consolidates the CLOSE keystrokes, which is the actually-shared pattern.
 *   - Callers that need to remember "operator manually closed" (e.g., the
 *     removed panel's `manuallyClosedRemovedRef`) supply an `onClose` callback
 *     that fires whenever `handleInput` consumes-and-closes. Programmatic
 *     `.close()` calls also fire it — callers that need to distinguish should
 *     manipulate their own state around a raw `.setIsOpen`-style approach.
 */
export interface UseOverlayPanelOptions {
  /** The keystroke that closes/toggles the panel (single character, e.g. 'c'). */
  toggleKey: string;
  /**
   * Optional. Fires whenever the panel transitions from open → closed, whether
   * via `close()`, `handleInput(toggleKey, …)`, or `handleInput(_, { escape:true })`.
   */
  onClose?: () => void;
}

export interface UseOverlayPanelResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /**
   * Feed keystrokes into this to consume-and-close. Returns `true` if the input
   * was consumed (caller should short-circuit the rest of their handler).
   * Consumes when `isOpen && (input === toggleKey || key.escape)`.
   */
  handleInput: (input: string, key: { escape?: boolean }) => boolean;
}

export function useOverlayPanel(opts: UseOverlayPanelOptions): UseOverlayPanelResult {
  const { toggleKey, onClose } = opts;
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen((prev) => {
      if (prev && onClose) onClose();
      return false;
    });
  }, [onClose]);

  const handleInput = useCallback(
    (input: string, key: { escape?: boolean }): boolean => {
      if (!isOpen) return false;
      if (input === toggleKey || key.escape === true) {
        if (onClose) onClose();
        setIsOpen(false);
        return true;
      }
      return false;
    },
    [isOpen, toggleKey, onClose],
  );

  return { isOpen, open, close, handleInput };
}
