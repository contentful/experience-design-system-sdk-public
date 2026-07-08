/**
 * Terminal-width-aware sidebar sizing for the import wizard steps
 * (ScopeGateStep + GenerateReviewStep).
 *
 * Formula: 45% of the terminal width, floored at 36 (the pre-INTEG-4412
 * fixed width) and capped at 60 (avoids absurdly wide sidebars on ultra-wide
 * monitors). When `process.stdout.columns` is undefined (tests, CI, non-TTY
 * pipes), callers pass 80 as the assumed default.
 */
export function computeSidebarWidth(terminalWidth: number): number {
  return Math.min(60, Math.max(36, Math.floor(terminalWidth * 0.45)));
}
