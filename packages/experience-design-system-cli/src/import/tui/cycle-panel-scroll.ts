export const CYCLE_PANEL_PREAMBLE_LINES = 4;

export interface CyclePanelLineCountable {
  suggestedBreak?: unknown;
}

export function cycleLineCount(cycle: CyclePanelLineCountable): number {
  return 3 + (cycle.suggestedBreak ? 1 : 0);
}

export function cycleLineOffsets(
  cycles: readonly CyclePanelLineCountable[],
  preamble: number = CYCLE_PANEL_PREAMBLE_LINES,
): number[] {
  const offsets: number[] = [];
  let acc = preamble;
  for (const cycle of cycles) {
    offsets.push(acc);
    acc += cycleLineCount(cycle);
  }
  return offsets;
}

export function totalCyclePanelLines(
  cycles: readonly CyclePanelLineCountable[],
  preamble: number = CYCLE_PANEL_PREAMBLE_LINES,
): number {
  let acc = preamble;
  for (const cycle of cycles) acc += cycleLineCount(cycle);
  return acc;
}

export function followCycleScroll(
  currentScroll: number,
  cursorIdx: number,
  cycles: readonly CyclePanelLineCountable[],
  panelHeight: number,
  preamble: number = CYCLE_PANEL_PREAMBLE_LINES,
): number {
  if (cursorIdx < 0 || cursorIdx >= cycles.length) return currentScroll;
  const offsets = cycleLineOffsets(cycles, preamble);
  const blockStart = offsets[cursorIdx];
  const lastContentLine = blockStart + cycleLineCount(cycles[cursorIdx]) - 2;
  let next = currentScroll;
  if (blockStart < currentScroll) next = blockStart;
  else if (lastContentLine >= currentScroll + panelHeight) next = lastContentLine - panelHeight + 1;
  const maxOffset = Math.max(0, totalCyclePanelLines(cycles, preamble) - panelHeight);
  return Math.max(0, Math.min(next, maxOffset));
}
