import type { ReportLine } from '../types/report.js';

export function stderrLines(stderr: string, limit: number): ReportLine[] {
  return stderr
    .trim()
    .split('\n')
    .slice(0, limit)
    .map((text): ReportLine => ({ kind: 'info', text }));
}
