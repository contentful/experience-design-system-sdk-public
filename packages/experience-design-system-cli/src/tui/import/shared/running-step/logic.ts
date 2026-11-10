export interface Progress {
  done: number;
  total: number;
}

export interface RunningLine {
  text: string;
  complete?: boolean;
  /** Set for a row that ended badly. A warning carries on without it; a failure does not. Otherwise `complete` decides. */
  state?: 'warning' | 'failed';
  progress?: Progress;
  /** How long the row took, once it has finished. */
  ms?: number;
}

export type LineState = 'running' | 'done' | 'warning' | 'failed';

/** What a row looks like. A row that ended badly is never shown as running or as done. */
export function lineState(line: RunningLine): LineState {
  if (line.state) return line.state;
  return line.complete ? 'done' : 'running';
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? '<1s' : formatElapsed(Math.round(ms / 1000));
}

/**
 * Whether the row has ended. A row is finished when it is complete or has failed. A warning alone does not say so: a row
 * can report failures so far (Generation does) and still be running.
 */
function isFinished(row: RunningLine): boolean {
  return row.complete === true || row.state === 'failed';
}

/**
 * How long each row took, by position, for the rows that have finished. A row's time is how long the run had been going
 * when it was first seen finished, and it does not change after that. Rows keep their position for the whole run, so a row
 * that appears later is added at the end.
 */
export function trackFinished(
  previous: ReadonlyArray<number | undefined>,
  rows: readonly RunningLine[],
  elapsedMs: number,
): Array<number | undefined> {
  return rows.map((row, index) => previous[index] ?? (isFinished(row) ? elapsedMs : undefined));
}

/**
 * Starts the clock and returns what to call with the rows after every progress event: the time each finished row took,
 * by position (see `trackFinished`).
 */
export function rowTimer(): (rows: readonly RunningLine[]) => Array<number | undefined> {
  const startedAt = Date.now();
  let rowMs: Array<number | undefined> = [];
  return (rows) => (rowMs = trackFinished(rowMs, rows, Date.now() - startedAt));
}

/** The rows with the time each finished row took, by position. */
export function withTimes(rows: RunningLine[], rowMs: ReadonlyArray<number | undefined>): RunningLine[] {
  return rows.map((row, index) => (rowMs[index] === undefined ? row : { ...row, ms: rowMs[index] }));
}

export function progressPercent(progress: Progress): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((progress.done / progress.total) * 100)));
}

export function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
