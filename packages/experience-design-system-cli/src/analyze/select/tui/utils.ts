/**
 * Compute the new sidebar scroll offset after moving selection to `idx`.
 * Keeps the selected item within the visible window.
 */
export function computeScrollOffset(idx: number, prev: number, visibleCount: number): number {
  if (idx < prev) return idx;
  if (idx >= prev + visibleCount) return idx - visibleCount + 1;
  return prev;
}
