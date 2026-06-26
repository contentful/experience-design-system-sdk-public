import { openPipelineDb, findLatestSessionForCommand } from '../../session/db.js';

/**
 * Read-only rationale view for the `analyze select-agent --show-rationale` flag.
 *
 * Reads the rationale data already persisted by a previous `analyze select-agent`
 * run (component-level decision + reject reason on raw_components; per-prop
 * rationale on raw_props — both populated by the writer path in command.ts and
 * the rationale columns added in the schema migration for PR #52). No LLM
 * invocation, no schema changes.
 *
 * Schema-version assertion: if the rationale columns are absent (older DB),
 * throw with a clear message pointing at the remediation step.
 */

export interface RationaleRow {
  name: string;
  decision: 'accepted' | 'rejected' | 'needs-review' | 'extracted';
  reason: string | null;
}

const REQUIRED_COLUMNS = ['status', 'reject_reason'] as const;

function assertSchema(dbPath?: string): void {
  const db = openPipelineDb(dbPath);
  try {
    const cols = db.prepare('PRAGMA table_info(raw_components)').all() as Array<{ name: string }>;
    const have = new Set(cols.map((c) => c.name));
    const missing = REQUIRED_COLUMNS.filter((c) => !have.has(c));
    if (missing.length > 0) {
      throw new Error(
        `Rationale data missing — run a fresh 'experiences import' on this session first. ` +
          `(raw_components is missing column(s): ${missing.join(', ')})`,
      );
    }
  } finally {
    db.close();
  }
}

/**
 * Resolves which session to read from. If `sessionFlag` is provided, asserts
 * the session exists and has at least one raw component; otherwise falls back
 * to the most recent completed `analyze select` step.
 */
export function resolveRationaleSession(sessionFlag: string | undefined, dbPath?: string): string {
  const db = openPipelineDb(dbPath);
  try {
    if (sessionFlag) {
      const row = db
        .prepare('SELECT 1 AS ok FROM raw_components WHERE session_id = ? LIMIT 1')
        .get(sessionFlag) as { ok: number } | undefined;
      if (!row) {
        throw new Error(
          `Session not found or has no components: '${sessionFlag}'. ` +
            `Run 'analyze extract' + 'analyze select-agent' on this session first.`,
        );
      }
      return sessionFlag;
    }
    const latest = findLatestSessionForCommand(db, 'analyze select');
    if (!latest) {
      throw new Error(
        `No completed 'analyze select' session found. Run 'analyze select-agent' first, or pass --session <id>.`,
      );
    }
    return latest;
  } finally {
    db.close();
  }
}

export function loadRationaleRows(sessionId: string, dbPath?: string): RationaleRow[] {
  const db = openPipelineDb(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT name, status, reject_reason FROM raw_components
         WHERE session_id = ?
         ORDER BY name`,
      )
      .all(sessionId) as Array<{ name: string; status: string; reject_reason: string | null }>;

    return rows.map((r) => ({
      name: r.name,
      decision: (r.status as RationaleRow['decision']) ?? 'extracted',
      reason: r.reject_reason,
    }));
  } finally {
    db.close();
  }
}

export function formatRationaleTable(rows: RationaleRow[]): string {
  if (rows.length === 0) {
    return 'No rationale rows found for this session.\n';
  }

  const header = { name: 'Component', decision: 'Decision', reason: 'Reason' };
  const all = [header, ...rows.map((r) => ({ name: r.name, decision: r.decision, reason: r.reason ?? '' }))];

  const nameWidth = Math.max(...all.map((r) => r.name.length));
  const decisionWidth = Math.max(...all.map((r) => r.decision.length));

  const lines: string[] = [];
  const fmt = (n: string, d: string, r: string): string =>
    `${n.padEnd(nameWidth)}  ${d.padEnd(decisionWidth)}  ${r}`;

  lines.push(fmt(header.name, header.decision, header.reason));
  lines.push(fmt('-'.repeat(nameWidth), '-'.repeat(decisionWidth), '-'.repeat(Math.max(6, header.reason.length))));
  for (const row of rows) {
    lines.push(fmt(row.name, row.decision, row.reason ?? ''));
  }
  return lines.join('\n') + '\n';
}

export function formatRationaleJson(rows: RationaleRow[]): string {
  return (
    JSON.stringify(
      rows.map((r) => ({ name: r.name, decision: r.decision, reason: r.reason })),
      null,
      2,
    ) + '\n'
  );
}

/**
 * Top-level dispatch for `analyze select-agent --show-rationale`. Pure I/O
 * boundary: reads DB, writes formatted output to stdout, throws on error.
 */
export function runShowRationale(opts: { session?: string; json?: boolean; dbPath?: string }): void {
  assertSchema(opts.dbPath);
  const sessionId = resolveRationaleSession(opts.session, opts.dbPath);
  const rows = loadRationaleRows(sessionId, opts.dbPath);
  const output = opts.json ? formatRationaleJson(rows) : formatRationaleTable(rows);
  process.stdout.write(output);
}
