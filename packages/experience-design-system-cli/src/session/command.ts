import type { Command } from 'commander';
import { openPipelineDb, getPipelineDbPath } from './db.js';
import { getStats, formatStatsText } from './stats.js';
import { runMigrationIfNeeded } from './migration.js';

function parseDuration(str: string): number | null {
  const m = /^(\d+)([dwmy])$/.exec(str);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const days = unit === 'd' ? n : unit === 'w' ? n * 7 : unit === 'm' ? n * 30 : n * 365;
  return days * 24 * 60 * 60 * 1000;
}

function formatDate(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

export function registerSessionCommand(program: Command): void {
  const session = program.command('session').description('Manage pipeline sessions');

  // session list
  session
    .command('list')
    .description('List all pipeline sessions')
    .option('--status <status>', 'Filter by status: in-progress, complete, failed, interrupted')
    .option('--all', 'Include interrupted sessions (hidden by default)')
    .option('--limit <n>', 'Max rows to return', '20')
    .option('--json', 'Force JSON output')
    .action((opts: { status?: string; all?: boolean; limit: string; json?: boolean }) => {
      const dbPath = getPipelineDbPath();
      const db = openPipelineDb(dbPath);
      runMigrationIfNeeded(db);

      const limit = parseInt(opts.limit, 10) || 20;

      const rows = db
        .prepare(
          `SELECT s.id, s.name, s.updated_at,
                  COUNT(st.id) AS step_count,
                  (SELECT command FROM steps WHERE session_id = s.id ORDER BY started_at DESC, id DESC LIMIT 1) AS last_step,
                  (SELECT status  FROM steps WHERE session_id = s.id ORDER BY started_at DESC, id DESC LIMIT 1) AS last_status
           FROM sessions s
           LEFT JOIN steps st ON st.session_id = s.id
           GROUP BY s.id
           ORDER BY s.updated_at DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
        id: string;
        name: string | null;
        updated_at: string;
        step_count: number;
        last_step: string | null;
        last_status: string | null;
      }>;

      let filtered = rows;
      if (opts.status) {
        const filterStatus = opts.status === 'in-progress' ? 'pending' : opts.status;
        filtered = rows.filter(
          (r) => r.last_status === filterStatus || (!r.last_status && opts.status === 'in-progress'),
        );
      } else if (!opts.all) {
        // Hide interrupted sessions by default — they're typically migration artifacts
        filtered = rows.filter((r) => r.last_status !== 'interrupted');
      }

      db.close();

      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            filtered.map((r) => ({
              id: r.id,
              name: r.name,
              status: r.last_status ?? null,
              stepCount: r.step_count,
              lastStep: r.last_step,
              updatedAt: r.updated_at,
            })),
            null,
            2,
          ) + '\n',
        );
        return;
      }

      if (filtered.length === 0) {
        process.stdout.write('No sessions found.\n');
        return;
      }

      const header = 'ID                    Name                Steps  Status       Last Step             Updated';
      process.stdout.write(header + '\n');
      process.stdout.write('─'.repeat(header.length) + '\n');
      for (const r of filtered) {
        const id = r.id.padEnd(22);
        const name = (r.name ?? '(none)').slice(0, 18).padEnd(20);
        const steps = String(r.step_count).padStart(5);
        const status = (r.last_status ?? '—').padEnd(13);
        const lastStep = (r.last_step ?? '—').padEnd(22);
        const updated = formatDate(r.updated_at);
        process.stdout.write(`${id}${name}${steps}  ${status}${lastStep}${updated}\n`);
      }
    });

  // session show
  session
    .command('show <id>')
    .description('Show all steps for a session')
    .option('--json', 'Force JSON output')
    .action((id: string, opts: { json?: boolean }) => {
      const dbPath = getPipelineDbPath();
      const db = openPipelineDb(dbPath);
      runMigrationIfNeeded(db);

      const sess = db.prepare('SELECT id, name, created_at, updated_at FROM sessions WHERE id = ?').get(id) as
        | { id: string; name: string | null; created_at: string; updated_at: string }
        | undefined;

      if (!sess) {
        db.close();
        process.stderr.write(`Error: session '${id}' not found.\n`);
        process.exit(1);
      }

      const steps = db
        .prepare(
          `SELECT id, command, status, started_at, completed_at, inputs, outputs, error
           FROM steps WHERE session_id = ? ORDER BY started_at ASC, id ASC`,
        )
        .all(id) as Array<{
        id: number;
        command: string;
        status: string;
        started_at: string;
        completed_at: string | null;
        inputs: string;
        outputs: string;
        error: string | null;
      }>;

      db.close();

      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            {
              id: sess.id,
              name: sess.name,
              createdAt: sess.created_at,
              updatedAt: sess.updated_at,
              steps: steps.map((s, i) => ({
                number: i + 1,
                command: s.command,
                status: s.status,
                startedAt: s.started_at,
                completedAt: s.completed_at,
                inputs: JSON.parse(s.inputs) as Record<string, string>,
                outputs: JSON.parse(s.outputs) as Record<string, string>,
                error: s.error,
              })),
            },
            null,
            2,
          ) + '\n',
        );
        return;
      }

      process.stdout.write(`Session: ${sess.id}\n`);
      process.stdout.write(`Name:    ${sess.name ?? '(none)'}\n`);
      process.stdout.write(`Created: ${formatDate(sess.created_at)}\n`);
      process.stdout.write(`Updated: ${formatDate(sess.updated_at)}\n`);
      process.stdout.write(`\nSteps\n${'─'.repeat(60)}\n`);

      for (const [i, s] of steps.entries()) {
        const num = String(i + 1).padStart(3);
        const cmd = s.command.padEnd(20);
        const stat = s.status.padEnd(12);
        const timing = s.completed_at
          ? `${s.started_at.slice(11, 16)} → ${s.completed_at.slice(11, 16)}`
          : `${s.started_at.slice(11, 16)} → …`;
        let inputs: Record<string, string> = {};
        let outputs: Record<string, string> = {};
        try {
          inputs = JSON.parse(s.inputs) as Record<string, string>;
          outputs = JSON.parse(s.outputs) as Record<string, string>;
        } catch {
          // ignore
        }
        const inputStr = Object.values(inputs).join(', ');
        const outputStr = Object.values(outputs).join(', ');
        const paths = [inputStr, outputStr].filter(Boolean).join(' → ');
        process.stdout.write(`${num}  ${cmd}${stat}${timing}  ${paths}\n`);
        if (s.error) {
          process.stdout.write(`     Error: ${s.error}\n`);
        }
      }
    });

  // session stats
  session
    .command('stats')
    .description('Show aggregate storage and record counts')
    .option('--json', 'Force JSON output')
    .action((opts: { json?: boolean }) => {
      const dbPath = getPipelineDbPath();
      const db = openPipelineDb(dbPath);
      runMigrationIfNeeded(db);
      const stats = getStats(db, dbPath);
      db.close();

      if (opts.json) {
        process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
        return;
      }

      process.stdout.write(formatStatsText(stats) + '\n');
    });

  // session prune
  session
    .command('prune')
    .description('Delete sessions matching criteria')
    .option('--id <id>', 'Delete a specific session by ID')
    .option('--older-than <duration>', 'Delete sessions older than this age (e.g. 30d, 2w, 1y)')
    .option('--status <status>', 'Delete sessions by last step status: complete, failed, interrupted')
    .option('--yes', 'Skip confirmation prompt')
    .option('--dry-run', 'Print what would be deleted without deleting')
    .action(async (opts: { id?: string; olderThan?: string; status?: string; yes?: boolean; dryRun?: boolean }) => {
      if (!opts.id && !opts.olderThan && !opts.status) {
        process.stderr.write('Error: at least one of --id, --older-than, or --status is required\n');
        process.exit(1);
      }

      const dbPath = getPipelineDbPath();
      const db = openPipelineDb(dbPath);
      runMigrationIfNeeded(db);

      // Build the list of sessions to delete
      let candidates: Array<{ id: string; updated_at: string }>;

      if (opts.id) {
        const sess = db.prepare('SELECT id, updated_at FROM sessions WHERE id = ?').get(opts.id) as
          | { id: string; updated_at: string }
          | undefined;
        if (!sess) {
          db.close();
          process.stderr.write(`Error: session '${opts.id}' not found.\n`);
          process.exit(1);
        }
        candidates = [sess];
      } else {
        candidates = db.prepare('SELECT id, updated_at FROM sessions ORDER BY updated_at DESC').all() as Array<{
          id: string;
          updated_at: string;
        }>;
      }

      if (opts.olderThan) {
        const ms = parseDuration(opts.olderThan);
        if (!ms) {
          db.close();
          process.stderr.write(`Error: invalid duration '${opts.olderThan}'. Use e.g. 30d, 2w, 1y.\n`);
          process.exit(1);
        }
        const cutoff = new Date(Date.now() - ms).toISOString();
        candidates = candidates.filter((c) => c.updated_at < cutoff);
      }

      if (opts.status) {
        const filterStatus = opts.status === 'in-progress' ? 'pending' : opts.status;
        candidates = candidates.filter((c) => {
          const lastStep = db
            .prepare('SELECT status FROM steps WHERE session_id = ? ORDER BY started_at DESC, id DESC LIMIT 1')
            .get(c.id) as { status: string } | undefined;
          return lastStep?.status === filterStatus;
        });
      }

      if (candidates.length === 0) {
        db.close();
        process.stdout.write('No sessions match the specified criteria.\n');
        return;
      }

      if (opts.dryRun) {
        db.close();
        process.stdout.write(`Would delete ${candidates.length} session(s):\n\n`);
        for (const c of candidates) {
          process.stdout.write(`  ${c.id.padEnd(22)}last updated ${c.updated_at.slice(0, 10)}\n`);
        }
        return;
      }

      if (!opts.yes && process.stdout.isTTY) {
        process.stdout.write(`This will delete ${candidates.length} session(s) matching your criteria.\n\n`);
        for (const c of candidates) {
          process.stdout.write(`  ${c.id.padEnd(22)}last updated ${c.updated_at.slice(0, 10)}\n`);
        }
        process.stdout.write('\nDelete these sessions? (y/N) ');

        const answer = await new Promise<string>((resolve) => {
          process.stdin.setEncoding('utf8');
          process.stdin.once('data', (chunk) => resolve(String(chunk).trim().toLowerCase()));
        });

        if (answer !== 'y') {
          db.close();
          process.stdout.write('Cancelled.\n');
          return;
        }
      }

      db.exec('BEGIN');
      try {
        for (const c of candidates) {
          db.prepare('DELETE FROM sessions WHERE id = ?').run(c.id);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        db.close();
        process.stderr.write(`Error: failed to delete sessions: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exit(1);
      }

      db.close();
      process.stdout.write(`Deleted ${candidates.length} session(s).\n`);
    });
}
