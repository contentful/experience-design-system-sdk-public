export interface Progress {
  done: number;
  total: number;
  label?: string;
}

export interface RunningLine {
  id?: string;
  text: string;
  detail?: string;
  complete?: boolean;
  failed?: boolean;
  pending?: boolean;
  progress?: Progress;
}

/** A moving segment indicates activity without inventing a percentage or completion estimate. */
export function activitySegment(seconds: number, width = 24, size = 4): number {
  const span = width - size;
  const position = seconds % (span * 2);
  return position <= span ? position : span * 2 - position;
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
