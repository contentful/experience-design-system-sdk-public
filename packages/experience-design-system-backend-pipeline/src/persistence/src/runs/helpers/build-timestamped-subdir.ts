import { join } from 'node:path';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function buildTimestampedSubdir(base: string, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  const ss = pad2(now.getSeconds());
  return join(base, `dsi-${y}${m}${d}-${hh}${mm}${ss}`);
}
