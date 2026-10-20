import type { DatabaseSync } from 'node:sqlite';
export function initializeExplorationSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exploration_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, phase TEXT NOT NULL CHECK (phase IN ('components','detail')), envelope_id TEXT NOT NULL, source_digest TEXT NOT NULL, component_run_id TEXT, scope_digest TEXT, status TEXT NOT NULL CHECK (status IN ('pending','complete','failed','cancelled')), error TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS exploration_current (session_id TEXT NOT NULL, phase TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES exploration_runs(id), PRIMARY KEY (session_id,phase));
    CREATE TABLE IF NOT EXISTS exploration_reports (run_id TEXT NOT NULL REFERENCES exploration_runs(id), scope TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY (run_id,scope));
    CREATE TABLE IF NOT EXISTS exploration_attempts (run_id TEXT NOT NULL REFERENCES exploration_runs(id), attempt_key TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY (run_id,attempt_key));
    CREATE TABLE IF NOT EXISTS exploration_records (run_id TEXT NOT NULL REFERENCES exploration_runs(id), family TEXT NOT NULL CHECK (family IN ('inclusion','slots','detail')), payload_json TEXT NOT NULL, PRIMARY KEY (run_id,family));
  `);
  const columns = new Set(
    (db.prepare('PRAGMA table_info(exploration_runs)').all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!columns.has('component_run_id')) db.exec('ALTER TABLE exploration_runs ADD COLUMN component_run_id TEXT');
  if (!columns.has('scope_digest')) db.exec('ALTER TABLE exploration_runs ADD COLUMN scope_digest TEXT');
}
