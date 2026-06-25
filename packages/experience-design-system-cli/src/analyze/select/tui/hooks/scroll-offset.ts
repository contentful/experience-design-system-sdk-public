/**
 * Pure helper for computing the next scroll offset when the operator presses
 * a navigation key inside a scrollable TUI panel (JSON view, rationale view,
 * etc.). Extracted as a shared module so multiple panels can reuse the same
 * scroll bindings without duplicating logic.
 *
 * Returns the new offset, or `null` if the input doesn't match any scroll
 * binding (caller should NOT update state in that case).
 *
 * Supported bindings:
 * - j / downArrow      → +1 line
 * - k / upArrow        → -1 line
 * - Ctrl+d             → +half-page (floor(panelHeight / 2))
 * - Ctrl+u             → -half-page
 * - PageDown           → +panelHeight
 * - PageUp             → -panelHeight
 * - G                  → jump to maxOffset
 *
 * `g` (single-tap) and `gg` (double-tap → jump to 0) are handled separately
 * by the caller via a pending-flag ref, since they need transient state.
 */
export type ScrollKeyState = {
  upArrow?: boolean;
  downArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  ctrl?: boolean;
};

export function computeNextScrollOffset(
  current: number,
  input: string,
  key: ScrollKeyState,
  totalLines: number,
  panelHeight: number,
): number | null {
  const maxOffset = Math.max(0, totalLines - panelHeight);
  const halfPage = Math.max(1, Math.floor(panelHeight / 2));

  if (key.ctrl && input === 'd') {
    return Math.min(maxOffset, current + halfPage);
  }
  if (key.ctrl && input === 'u') {
    return Math.max(0, current - halfPage);
  }
  if (key.downArrow || input === 'j') {
    return Math.min(maxOffset, current + 1);
  }
  if (key.upArrow || input === 'k') {
    return Math.max(0, current - 1);
  }
  if (key.pageDown) {
    return Math.min(maxOffset, current + panelHeight);
  }
  if (key.pageUp) {
    return Math.max(0, current - panelHeight);
  }
  if (input === 'G') {
    return maxOffset;
  }
  return null;
}
