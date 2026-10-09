export const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    cli_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS composition_cache (
    input_hash TEXT NOT NULL,
    cli_version TEXT NOT NULL,
    agent_output TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (input_hash, cli_version)
  );

  CREATE TABLE IF NOT EXISTS selection_cache (
    component_hash TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    cli_version TEXT NOT NULL,
    decision TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (component_hash, prompt_hash, cli_version)
  );

  CREATE TABLE IF NOT EXISTS generation_cache (
    input_hash TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    cli_version TEXT NOT NULL,
    cdf_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (input_hash, prompt_hash, cli_version)
  );
`;
