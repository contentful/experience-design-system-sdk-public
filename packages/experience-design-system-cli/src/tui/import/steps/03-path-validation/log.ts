import { importModeLabel, type ImportTarget } from '../00-preflight/logic.js';
import { describeFailure, summarize, type ScanResult } from './logic.js';

// What the debug log says about the Path validation: what the scan found, how long it took, and what the user did next.
// The scan is synchronous, so its duration shows whether a large project held the screen up. File paths are left out,
// since a project can have thousands; the counts are what show whether the scan found the components. The path the user
// typed is in the Welcome log, so this one only says where it resolved to.

export type PathOutcome = 'continued' | 'changed-path' | 'back';

const OUTCOME_TEXT: Record<PathOutcome, string> = {
  continued: 'continued',
  'changed-path': 'changed the path',
  back: 'went back',
};

// A project full of odd files must not make the log grow without bound.
const MAX_WARNINGS = 10;

const duration = (ms: number): string => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

/** The log's two sections: `summary` for a person, `data` for AI, both carrying the same facts. */
export function pathValidationLog({
  mode,
  resolvedPath,
  scan,
  scanMs,
  outcome,
  hasTokens,
}: {
  mode: ImportTarget;
  resolvedPath: string;
  /** Undefined when the user left before the scan finished. */
  scan: ScanResult | undefined;
  scanMs: number | undefined;
  outcome: PathOutcome;
  hasTokens: boolean;
}): { summary: string[]; data: Record<string, unknown> } {
  const summary = [`Import mode: ${importModeLabel(mode)}`, `Project path: ${resolvedPath}`];
  const data: Record<string, unknown> = { import_mode: mode, resolved_path: resolvedPath };

  if (scan === undefined) {
    summary.push('Scan: not finished');
    data['scan'] = 'unfinished';
  } else if (!scan.ok) {
    const error = describeFailure(scan.failure, resolvedPath).headline;
    summary.push(`Scan failed: ${error}`);
    Object.assign(data, { scan: 'failed', failure: scan.failure, error });
  } else {
    const { total, rows, warning } = summarize(scan.counts, { hasTokens });
    const { total: _total, ...byType } = scan.counts;
    const warnings = [...(warning ? [warning] : []), ...scan.warnings];
    const shown = warnings.slice(0, MAX_WARNINGS);

    summary.push(
      `Scan: ${total} files${scanMs === undefined ? '' : ` in ${duration(scanMs)}`}`,
      ...rows.map((row) => `  ${row.label}: ${row.count}`),
      warnings.length === 0 ? 'Warnings: none' : 'Warnings:',
      ...shown.map((text) => `  ${text}`),
      ...(warnings.length > shown.length ? [`  …and ${warnings.length - shown.length} more`] : []),
    );
    Object.assign(data, {
      scan: 'ok',
      ...(scanMs === undefined ? {} : { scan_ms: scanMs }),
      files_found: total,
      counts: Object.fromEntries(Object.entries(byType).filter(([, count]) => count > 0)),
      warnings: shown,
      warning_count: warnings.length,
    });
  }

  summary.push(`Outcome: ${OUTCOME_TEXT[outcome]}`);
  data['outcome'] = outcome;
  return { summary, data };
}
