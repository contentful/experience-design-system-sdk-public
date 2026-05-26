import type { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';

export interface SessionStats {
  dbPath: string;
  dbBytes: number;
  walBytes: number;
  totalBytes: number;
  sessions: {
    total: number;
    complete: number;
    inProgress: number;
    failed: number;
    interrupted: number;
  };
  steps: number;
  rawComponents: number;
  oldestSession: { id: string; updatedAt: string } | null;
  newestSession: { id: string; updatedAt: string } | null;
}

export function getStats(db: DatabaseSync, dbPath: string): SessionStats {
  const pageCountRow = db.prepare('PRAGMA page_count').get() as { page_count: number };
  const pageSizeRow = db.prepare('PRAGMA page_size').get() as { page_size: number };
  const dbBytes = pageCountRow.page_count * pageSizeRow.page_size;

  let walBytes = 0;
  try {
    walBytes = statSync(`${dbPath}-wal`).size;
  } catch {
    // WAL file doesn't exist
  }

  // Session counts by status of last step
  const sessionTotal = (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;

  const statusCounts = db
    .prepare(
      `SELECT last_status, COUNT(*) AS n
       FROM (
         SELECT session_id,
                status AS last_status,
                ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY started_at DESC, id DESC) AS rn
         FROM steps
       )
       WHERE rn = 1
       GROUP BY last_status`,
    )
    .all() as Array<{ last_status: string; n: number }>;

  const byStatus: Record<string, number> = {};
  for (const row of statusCounts) {
    byStatus[row.last_status] = row.n;
  }

  // Sessions with no steps at all count as in-progress
  const sessionsWithSteps = statusCounts.reduce((a, r) => a + r.n, 0);
  const sessionsWithNoSteps = sessionTotal - sessionsWithSteps;

  const stepsTotal = (db.prepare('SELECT COUNT(*) AS n FROM steps').get() as { n: number }).n;
  const rawComponents = (db.prepare('SELECT COUNT(*) AS n FROM raw_components').get() as { n: number }).n;

  const oldest = db.prepare('SELECT id, updated_at FROM sessions ORDER BY updated_at ASC LIMIT 1').get() as
    | { id: string; updated_at: string }
    | undefined;
  const newest = db.prepare('SELECT id, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 1').get() as
    | { id: string; updated_at: string }
    | undefined;

  return {
    dbPath,
    dbBytes,
    walBytes,
    totalBytes: dbBytes + walBytes,
    sessions: {
      total: sessionTotal,
      complete: byStatus['complete'] ?? 0,
      inProgress: (byStatus['pending'] ?? 0) + sessionsWithNoSteps,
      failed: byStatus['failed'] ?? 0,
      interrupted: byStatus['interrupted'] ?? 0,
    },
    steps: stepsTotal,
    rawComponents,
    oldestSession: oldest ? { id: oldest.id, updatedAt: oldest.updated_at } : null,
    newestSession: newest ? { id: newest.id, updatedAt: newest.updated_at } : null,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatStatsText(stats: SessionStats): string {
  const lines: string[] = [
    `Pipeline DB: ${stats.dbPath}`,
    ``,
    `  Database size   ${formatBytes(stats.dbBytes).padStart(10)}`,
    `  WAL file size   ${formatBytes(stats.walBytes).padStart(10)}`,
    `  Total on disk   ${formatBytes(stats.totalBytes).padStart(10)}`,
    ``,
    `  Sessions        ${String(stats.sessions.total).padStart(10)}`,
    `    complete      ${String(stats.sessions.complete).padStart(10)}`,
    `    in-progress   ${String(stats.sessions.inProgress).padStart(10)}`,
    `    failed        ${String(stats.sessions.failed).padStart(10)}`,
    `    interrupted   ${String(stats.sessions.interrupted).padStart(10)}`,
    ``,
    `  Steps           ${String(stats.steps).padStart(10)}`,
    `  Raw components  ${String(stats.rawComponents).padStart(10)}`,
  ];

  if (stats.oldestSession) {
    const date = stats.oldestSession.updatedAt.slice(0, 10);
    lines.push(``, `  Oldest session  ${date}  (${stats.oldestSession.id})`);
  }
  if (stats.newestSession && stats.newestSession.id !== stats.oldestSession?.id) {
    const date = stats.newestSession.updatedAt.slice(0, 10);
    lines.push(`  Newest session  ${date}  (${stats.newestSession.id})`);
  }

  lines.push(``, `Run \`session prune --older-than <age>\` to free space.`);
  return lines.join('\n');
}
