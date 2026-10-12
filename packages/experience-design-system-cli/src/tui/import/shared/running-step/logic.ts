export interface Progress {
  done: number;
  total: number;
}

export interface RunningLine {
  text: string;
  complete?: boolean;
  progress?: Progress;
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

export function stepLabel(stepNumber: number, totalSteps: number, title: string): string {
  return `Step ${stepNumber} of ${totalSteps} — ${title}`;
}
