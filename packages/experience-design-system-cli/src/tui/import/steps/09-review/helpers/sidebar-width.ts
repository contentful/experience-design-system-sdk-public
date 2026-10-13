export function computeSidebarWidth(terminalWidth: number): number {
  return Math.min(60, Math.max(36, Math.floor(terminalWidth * 0.45)));
}
