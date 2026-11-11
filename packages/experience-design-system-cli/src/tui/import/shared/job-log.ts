import { formatDuration, lineState, type RunningLine } from './running-step/logic.js';

// How the steps that run in the background (extraction, generation) put their rows in a debug log. The rows are the ones
// the screen showed, so the log reads the way the user saw the step go, with how long each one took.

/** The rows as sub-points: what each one did, and how long it took once it had finished. */
export function jobLines(rows: readonly RunningLine[]): string[] {
  return rows.map((row) => `  ${row.text}${row.ms === undefined ? '' : ` (${formatDuration(row.ms)})`}`);
}

/** The same rows as data. */
export function jobData(rows: readonly RunningLine[]): Array<{ text: string; state: string; ms?: number }> {
  return rows.map((row) => ({
    text: row.text,
    state: lineState(row),
    ...(row.ms === undefined ? {} : { ms: row.ms }),
  }));
}
