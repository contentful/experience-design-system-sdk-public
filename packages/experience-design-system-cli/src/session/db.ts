import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { generateSessionId } from './session-id.js';
import type { RawComponentDefinition, RawPropDefinition, RawSlotDefinition } from '../types.js';
import type { CDFComponentEntry, DTCGTokenEntry, DTCGTokenGroup } from '@contentful/experience-design-system-types';
import type { ToolCall, TokenToolCall } from '../generate/agent-runner.js';
import type { ComponentTypeSummary } from '@contentful/experience-design-system-types';

export type StepStatus = 'pending' | 'complete' | 'failed' | 'interrupted';
export type CommandName =
  | 'analyze extract'
  | 'analyze select'
  | 'generate components'
  | 'generate tokens'
  | 'generate edit'
  | 'apply preview'
  | 'apply select'
  | 'apply push'
  | 'print components'
  | 'print tokens'
  | 'import';

export interface SessionRow {
  id: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface StepRow {
  id: number;
  session_id: string;
  command: string;
  status: StepStatus;
  started_at: string;
  completed_at: string | null;
  inputs: string;
  outputs: string;
  error: string | null;
  updated_at: string;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migrations (
  name        TEXT NOT NULL PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT NOT NULL PRIMARY KEY,
  name        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  command       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  inputs        TEXT NOT NULL DEFAULT '{}',
  outputs       TEXT NOT NULL DEFAULT '{}',
  error         TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_components (
  session_id             TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  component_id           TEXT NOT NULL,
  name                   TEXT NOT NULL,
  source                 TEXT NOT NULL,
  framework              TEXT NOT NULL,
  extracted_at           TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'extracted',
  cdf_schema             TEXT,
  description            TEXT,
  extraction_confidence  INTEGER,
  review_reasons         TEXT NOT NULL DEFAULT '[]',
  needs_review           INTEGER NOT NULL DEFAULT 0,
  source_path            TEXT,
  reject_reason          TEXT,
  PRIMARY KEY (session_id, component_id)
);

CREATE TABLE IF NOT EXISTS raw_props (
  session_id        TEXT NOT NULL,
  component_id      TEXT NOT NULL,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL,
  required          INTEGER NOT NULL CHECK (required IN (0, 1)),
  category          TEXT CHECK (category IN ('content', 'design', 'state')),
  default_value     TEXT,
  description       TEXT,
  token_reference   TEXT,
  position          INTEGER NOT NULL,
  cdf_type          TEXT,
  cdf_category      TEXT CHECK (cdf_category IN ('content', 'design', 'state')),
  cdf_token_kind    TEXT,
  rationale         TEXT,
  source_start_line INTEGER,
  source_end_line   INTEGER,
  PRIMARY KEY (session_id, component_id, name),
  FOREIGN KEY (session_id, component_id) REFERENCES raw_components(session_id, component_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raw_prop_allowed_values (
  session_id   TEXT NOT NULL,
  component_id TEXT NOT NULL,
  prop_name    TEXT NOT NULL,
  position     INTEGER NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (session_id, component_id, prop_name, position),
  FOREIGN KEY (session_id, component_id, prop_name) REFERENCES raw_props(session_id, component_id, name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raw_slots (
  session_id   TEXT NOT NULL,
  component_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  is_default   INTEGER NOT NULL CHECK (is_default IN (0, 1)),
  description  TEXT,
  position     INTEGER NOT NULL,
  required     INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  PRIMARY KEY (session_id, component_id, name),
  FOREIGN KEY (session_id, component_id) REFERENCES raw_components(session_id, component_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raw_slot_allowed_components (
  session_id        TEXT NOT NULL,
  component_id      TEXT NOT NULL,
  slot_name         TEXT NOT NULL,
  position          INTEGER NOT NULL,
  allowed_component TEXT NOT NULL,
  PRIMARY KEY (session_id, component_id, slot_name, position),
  FOREIGN KEY (session_id, component_id, slot_name) REFERENCES raw_slots(session_id, component_id, name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raw_token_groups (
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  description  TEXT,
  PRIMARY KEY (session_id, path)
);

CREATE TABLE IF NOT EXISTS raw_tokens (
  session_id   TEXT NOT NULL,
  path         TEXT NOT NULL,
  type         TEXT NOT NULL,
  value        TEXT NOT NULL,
  description  TEXT,
  PRIMARY KEY (session_id, path),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generation_cache (
  input_hash        TEXT NOT NULL,
  entity_type       TEXT NOT NULL CHECK (entity_type IN ('component', 'token_set')),
  entity_id         TEXT NOT NULL,
  source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  human_edited      INTEGER NOT NULL DEFAULT 0 CHECK (human_edited IN (0, 1)),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (input_hash, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS scanned_files (
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  PRIMARY KEY (session_id, path)
);

CREATE INDEX IF NOT EXISTS idx_steps_session            ON steps(session_id);
CREATE INDEX IF NOT EXISTS idx_steps_command            ON steps(session_id, command);
CREATE INDEX IF NOT EXISTS idx_raw_components_session   ON raw_components(session_id);
CREATE INDEX IF NOT EXISTS idx_raw_props_session        ON raw_props(session_id, component_id);
CREATE INDEX IF NOT EXISTS idx_raw_slots_session        ON raw_slots(session_id, component_id);
CREATE INDEX IF NOT EXISTS idx_raw_tokens_session       ON raw_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_raw_token_groups_session ON raw_token_groups(session_id);
CREATE INDEX IF NOT EXISTS idx_generation_cache_entity  ON generation_cache(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_generation_cache_session ON generation_cache(source_session_id);
CREATE INDEX IF NOT EXISTS idx_scanned_files_session    ON scanned_files(session_id);
`;

export function getPipelineDbPath(): string {
  if (process.env.EDS_PIPELINE_DB_PATH) {
    return resolve(process.env.EDS_PIPELINE_DB_PATH);
  }
  return resolve(homedir(), '.contentful', 'experience-design-system-cli', 'pipeline.db');
}

export function openPipelineDb(dbPath?: string): DatabaseSync {
  const path = dbPath ?? getPipelineDbPath();
  mkdirSync(dirname(path), { recursive: true });
  try {
    const db = new DatabaseSync(path);
    db.exec(SCHEMA);
    applyDbMigrations(db);
    return db;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('database is locked')) {
      process.stderr.write('Error: another CLI process is already running. Wait for it to finish and retry.\n');
      process.exit(1);
    }
    throw e;
  }
}

function applyDbMigrations(db: DatabaseSync): void {
  // Add raw_slots.required column if it doesn't exist yet (added in v0.5.14).
  const cols = db.prepare('PRAGMA table_info(raw_slots)').all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === 'required')) {
    db.exec('ALTER TABLE raw_slots ADD COLUMN required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1))');
  }

  // Add extraction confidence scoring columns if they don't exist yet (added in v0.6.0).
  const rawCompCols = db.prepare('PRAGMA table_info(raw_components)').all() as Array<{ name: string }>;
  const rawCompColNames = new Set(rawCompCols.map((c) => c.name));
  if (!rawCompColNames.has('extraction_confidence')) {
    db.exec('ALTER TABLE raw_components ADD COLUMN extraction_confidence INTEGER');
  }
  if (!rawCompColNames.has('review_reasons')) {
    db.exec("ALTER TABLE raw_components ADD COLUMN review_reasons TEXT NOT NULL DEFAULT '[]'");
  }
  if (!rawCompColNames.has('needs_review')) {
    db.exec('ALTER TABLE raw_components ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0');
  }

  // Feature 1: per-component source path on raw_components, rationale + per-prop
  // source location on raw_props. All nullable, no DEFAULT — existing rows survive.
  if (!rawCompColNames.has('source_path')) {
    db.exec('ALTER TABLE raw_components ADD COLUMN source_path TEXT');
  }
  const rawPropCols = db.prepare('PRAGMA table_info(raw_props)').all() as Array<{ name: string }>;
  const rawPropColNames = new Set(rawPropCols.map((c) => c.name));
  if (!rawPropColNames.has('rationale')) {
    db.exec('ALTER TABLE raw_props ADD COLUMN rationale TEXT');
  }
  if (!rawPropColNames.has('source_start_line')) {
    db.exec('ALTER TABLE raw_props ADD COLUMN source_start_line INTEGER');
  }
  if (!rawPropColNames.has('source_end_line')) {
    db.exec('ALTER TABLE raw_props ADD COLUMN source_end_line INTEGER');
  }

  // Feature 3: persist select-agent's reject reason on raw_components. Nullable,
  // no DEFAULT — accepted components keep NULL, rejected ones store the LLM's
  // reason (or `validation error: <codes>` for validation auto-rejections).
  if (!rawCompColNames.has('reject_reason')) {
    db.exec('ALTER TABLE raw_components ADD COLUMN reject_reason TEXT');
  }

  // Add generation_cache table if it doesn't exist yet.
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='generation_cache'`)
    .all() as Array<{ name: string }>;
  if (tables.length === 0) {
    db.exec(`
      CREATE TABLE generation_cache (
        input_hash        TEXT NOT NULL,
        entity_type       TEXT NOT NULL CHECK (entity_type IN ('component', 'token_set')),
        entity_id         TEXT NOT NULL,
        source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        human_edited      INTEGER NOT NULL DEFAULT 0 CHECK (human_edited IN (0, 1)),
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (input_hash, entity_type, entity_id)
      );
      CREATE INDEX idx_generation_cache_entity ON generation_cache(entity_type, entity_id);
      CREATE INDEX idx_generation_cache_session ON generation_cache(source_session_id);
    `);
  }
}

export interface ApplyToolCallsResult {
  classified: number;
  excluded: number;
  slots: number;
  warnings: string[];
}

/**
 * Feature 1: load per-component metadata for surfacing in the review UI —
 * source path, full source text, and per-prop rationale + source-location.
 * Returns null when no row matches. Decoupled from loadCDFComponents so
 * the CDF projection stays unaffected.
 */
export interface ComponentReviewMetadata {
  sourcePath: string | null;
  componentSource: string | null;
  props: Record<string, { rationale: string | null; sourceStartLine: number | null; sourceEndLine: number | null }>;
}

export function loadComponentReviewMetadata(
  db: DatabaseSync,
  sessionId: string,
  componentName: string,
): ComponentReviewMetadata | null {
  const compRow = db
    .prepare(
      `SELECT component_id, source, source_path FROM raw_components WHERE session_id = ? AND name = ?`,
    )
    .get(sessionId, componentName) as { component_id: string; source: string; source_path: string | null } | undefined;
  if (!compRow) return null;

  const propRows = db
    .prepare(
      `SELECT name, rationale, source_start_line, source_end_line FROM raw_props WHERE session_id = ? AND component_id = ?`,
    )
    .all(sessionId, compRow.component_id) as Array<{
    name: string;
    rationale: string | null;
    source_start_line: number | null;
    source_end_line: number | null;
  }>;

  const props: ComponentReviewMetadata['props'] = {};
  for (const r of propRows) {
    props[r.name] = {
      rationale: r.rationale,
      sourceStartLine: r.source_start_line,
      sourceEndLine: r.source_end_line,
    };
  }

  // raw_components.source historically stores the file path, not the file
  // text. For the source-view panel to render real lines, prefer reading
  // the file from disk via source_path. Fall back to whatever's in `source`
  // (handles in-memory fixtures and tests).
  let componentSource: string | null = compRow.source ?? null;
  if (compRow.source_path) {
    try {
      componentSource = readFileSync(compRow.source_path, 'utf8');
    } catch {
      // File no longer exists or unreadable — leave fallback.
    }
  }

  return {
    sourcePath: compRow.source_path,
    componentSource,
    props,
  };
}

export function applyToolCalls(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  componentName: string,
  calls: ToolCall[],
  incomingWarnings: string[],
): ApplyToolCallsResult {
  const now = new Date().toISOString();
  const warnings = [...incomingWarnings];
  let classified = 0;
  let excluded = 0;
  let slots = 0;

  const updateProp = db.prepare(
    `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?, required = ?, description = ?, rationale = ?
     WHERE session_id = ? AND component_id = ? AND name = ?`,
  );
  const clearProp = db.prepare(
    `UPDATE raw_props SET cdf_type = 'excluded', cdf_category = NULL, cdf_token_kind = NULL, rationale = ?
     WHERE session_id = ? AND component_id = ? AND name = ?`,
  );
  const deleteAllowedValues = db.prepare(
    `DELETE FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ? AND prop_name = ?`,
  );
  const insertAllowedValue = db.prepare(
    `INSERT OR IGNORE INTO raw_prop_allowed_values (session_id, component_id, prop_name, value, position)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const deleteAllowedComponents = db.prepare(
    `DELETE FROM raw_slot_allowed_components WHERE session_id = ? AND component_id = ? AND slot_name = ?`,
  );
  const insertAllowedComponent = db.prepare(
    `INSERT OR IGNORE INTO raw_slot_allowed_components (session_id, component_id, slot_name, allowed_component, position)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const updateSlot = db.prepare(
    `UPDATE raw_slots SET required = ?, description = ? WHERE session_id = ? AND component_id = ? AND name = ?`,
  );

  db.exec('BEGIN');
  try {
    for (const call of calls) {
      if (call.tool === 'classify_component') {
        if (call.description !== undefined) {
          db.prepare('UPDATE raw_components SET description = ? WHERE session_id = ? AND component_id = ?').run(
            call.description,
            sessionId,
            componentId,
          );
        }
      } else if (call.tool === 'classify_prop') {
        const changes = updateProp.run(
          call.cdf_type,
          call.cdf_category,
          call.token_kind ?? null,
          call.required !== undefined ? (call.required ? 1 : 0) : 0,
          call.description ?? null,
          call.reason ?? null,
          sessionId,
          componentId,
          call.prop,
        ) as { changes: number };
        if (changes.changes === 0) {
          warnings.push(`${componentName}: classify_prop '${call.prop}' — prop not found, skipped`);
          continue;
        }
        if (call.values && call.values.length > 0) {
          deleteAllowedValues.run(sessionId, componentId, call.prop);
          call.values.forEach((v, i) => insertAllowedValue.run(sessionId, componentId, call.prop, v, i));
        }
        if (call.default !== undefined) {
          const storedDefault = typeof call.default === 'boolean' ? String(call.default) : call.default;
          db.prepare(
            `UPDATE raw_props SET default_value = ? WHERE session_id = ? AND component_id = ? AND name = ?`,
          ).run(storedDefault, sessionId, componentId, call.prop);
        }
        classified++;
      } else if (call.tool === 'exclude_prop') {
        clearProp.run(call.reason || null, sessionId, componentId, call.prop);
        excluded++;
      } else if (call.tool === 'classify_slot') {
        const slotRequired = call.required !== undefined ? (call.required ? 1 : 0) : 1;
        const slotChanges = updateSlot.run(
          slotRequired,
          call.description ?? null,
          sessionId,
          componentId,
          call.slot,
        ) as { changes: number };
        if (slotChanges.changes === 0) {
          warnings.push(`${componentName}: classify_slot '${call.slot}' — slot not found, skipped`);
          continue;
        }
        if (call.allowed_components !== undefined) {
          deleteAllowedComponents.run(sessionId, componentId, call.slot);
          call.allowed_components.forEach((ac, i) =>
            insertAllowedComponent.run(sessionId, componentId, call.slot, ac, i),
          );
        }
        slots++;
      }
    }

    db.prepare(
      `UPDATE raw_components SET status = 'generated', extracted_at = ? WHERE session_id = ? AND component_id = ?`,
    ).run(now, sessionId, componentId);
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { classified, excluded, slots, warnings };
}

export interface MatchHints {
  command: CommandName;
  inputPath?: string;
  outDir?: string;
}

export interface SessionResolution {
  sessionId: string;
  isNew: boolean;
  isResumed: boolean;
}

export function getOrCreateSession(
  db: DatabaseSync,
  sessionFlag: string | undefined,
  sessionName: string | undefined,
  hints: MatchHints,
): SessionResolution {
  const now = new Date().toISOString();

  if (sessionFlag === 'new' || sessionFlag === undefined) {
    if (sessionFlag !== 'new') {
      const match = findMatchingSession(db, hints);
      if (match) {
        return { sessionId: match, isNew: false, isResumed: true };
      }
    }
    const id = generateSessionId();
    db.prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      id,
      sessionName ?? null,
      now,
      now,
    );
    return { sessionId: id, isNew: true, isResumed: false };
  }

  const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionFlag) as { id: string } | undefined;
  if (!existing) {
    throw new Error(`session '${sessionFlag}' not found. Run 'session list' to see active sessions.`);
  }
  return { sessionId: sessionFlag, isNew: false, isResumed: false };
}

function findMatchingSession(db: DatabaseSync, hints: MatchHints): string | null {
  if (!hints.inputPath && !hints.outDir) return null;

  const rows = db
    .prepare(
      `SELECT s.id, st.inputs, st.outputs, st.status
       FROM sessions s
       JOIN steps st ON st.session_id = s.id
       WHERE st.command = ?
         AND st.status IN ('pending', 'interrupted')
       ORDER BY st.started_at DESC
       LIMIT 20`,
    )
    .all(hints.command) as Array<{
    id: string;
    inputs: string;
    outputs: string;
    status: string;
  }>;

  for (const row of rows) {
    let inputs: Record<string, string> = {};
    try {
      inputs = JSON.parse(row.inputs) as Record<string, string>;
    } catch {
      continue;
    }

    if (hints.inputPath) {
      const inputValues = Object.values(inputs);
      if (inputValues.some((v) => v === hints.inputPath)) {
        return row.id;
      }
    }

    if (hints.outDir) {
      let outputs: Record<string, string> = {};
      try {
        outputs = JSON.parse(row.outputs) as Record<string, string>;
      } catch {
        // ignore
      }
      const allValues = [...Object.values(inputs), ...Object.values(outputs)];
      if (allValues.some((v) => v === hints.outDir)) {
        return row.id;
      }
    }
  }

  return null;
}

export function createStep(
  db: DatabaseSync,
  sessionId: string,
  command: CommandName,
  inputs: Record<string, string>,
): number {
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE steps SET status = 'interrupted', completed_at = ?, updated_at = ?
       WHERE session_id = ? AND command = ? AND status = 'pending'`,
    ).run(now, now, sessionId, command);

    const result = db
      .prepare(
        `INSERT INTO steps (session_id, command, status, started_at, inputs, outputs, updated_at)
         VALUES (?, ?, 'pending', ?, ?, '{}', ?)`,
      )
      .run(sessionId, command, now, JSON.stringify(inputs), now) as {
      lastInsertRowid: number | bigint;
    };

    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

    db.exec('COMMIT');
    return Number(result.lastInsertRowid);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function updateStep(
  db: DatabaseSync,
  stepId: number,
  status: 'complete' | 'failed',
  outputs: Record<string, string>,
  error?: string,
): void {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const step = db.prepare('SELECT session_id FROM steps WHERE id = ?').get(stepId) as
      | { session_id: string }
      | undefined;

    db.prepare(
      `UPDATE steps SET status = ?, completed_at = ?, outputs = ?, error = ?, updated_at = ? WHERE id = ?`,
    ).run(status, now, JSON.stringify(outputs), error ?? null, now, stepId);

    if (step) {
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, step.session_id);
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function storeRawComponents(
  db: DatabaseSync,
  sessionId: string,
  components: RawComponentDefinition[],
  options?: { status?: string; preserveCDF?: boolean },
): void {
  const now = new Date().toISOString();

  const insertComp = db.prepare(
    `INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at, extraction_confidence, review_reasons, needs_review, source_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertProp = db.prepare(
    `INSERT INTO raw_props
       (session_id, component_id, name, type, required, category, default_value, description, token_reference, position, source_start_line, source_end_line)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAllowedValue = db.prepare(
    `INSERT INTO raw_prop_allowed_values (session_id, component_id, prop_name, position, value)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertSlot = db.prepare(
    `INSERT INTO raw_slots (session_id, component_id, name, is_default, description, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertAllowedComponent = db.prepare(
    `INSERT INTO raw_slot_allowed_components (session_id, component_id, slot_name, position, allowed_component)
     VALUES (?, ?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    // Snapshot CDF classification data before deleting if preservation requested
    type CDFSnapshot = {
      component_id: string;
      name: string;
      position: number;
      cdf_type: string;
      cdf_category: string;
      cdf_token_kind: string | null;
    };
    type DescSnapshot = { component_id: string; description: string };
    type AVSnapshot = { component_id: string; prop_name: string; position: number; value: string };

    let cdfSnapshot: CDFSnapshot[] = [];
    let descSnapshot: DescSnapshot[] = [];
    let avSnapshot: AVSnapshot[] = [];

    if (options?.preserveCDF) {
      cdfSnapshot = db
        .prepare(
          `SELECT component_id, name, position, cdf_type, cdf_category, cdf_token_kind
           FROM raw_props WHERE session_id = ? AND cdf_type IS NOT NULL`,
        )
        .all(sessionId) as CDFSnapshot[];

      descSnapshot = db
        .prepare(
          `SELECT component_id, description
           FROM raw_components WHERE session_id = ? AND description IS NOT NULL`,
        )
        .all(sessionId) as DescSnapshot[];

      if (cdfSnapshot.length > 0) {
        avSnapshot = db
          .prepare(
            `SELECT component_id, prop_name, position, value
             FROM raw_prop_allowed_values WHERE session_id = ?`,
          )
          .all(sessionId) as AVSnapshot[];
      }
    }

    db.prepare('DELETE FROM raw_components WHERE session_id = ?').run(sessionId);

    for (const comp of components) {
      const componentId = deriveComponentId(comp.name, comp.source);
      insertComp.run(
        sessionId,
        componentId,
        comp.name,
        comp.source,
        comp.framework,
        now,
        comp.extractionConfidence ?? null,
        JSON.stringify(comp.reviewReasons ?? []),
        comp.needsReview ? 1 : 0,
        comp.sourcePath ?? null,
      );

      for (let i = 0; i < comp.props.length; i++) {
        const prop = comp.props[i]!;
        insertProp.run(
          sessionId,
          componentId,
          prop.name,
          prop.type,
          prop.required ? 1 : 0,
          prop.category ?? null,
          prop.defaultValue ?? null,
          prop.description ?? null,
          prop.tokenReference ?? null,
          i,
          prop.sourceStartLine ?? null,
          prop.sourceEndLine ?? null,
        );
        if (prop.allowedValues) {
          prop.allowedValues.forEach((v, j) => insertAllowedValue.run(sessionId, componentId, prop.name, j, v));
        }
      }

      for (let i = 0; i < comp.slots.length; i++) {
        const slot = comp.slots[i]!;
        insertSlot.run(sessionId, componentId, slot.name, slot.isDefault ? 1 : 0, slot.description ?? null, i);
        if (slot.allowedComponents) {
          slot.allowedComponents.forEach((ac, j) =>
            insertAllowedComponent.run(sessionId, componentId, slot.name, j, ac),
          );
        }
      }
    }

    // Restore CDF classification data for props that still exist
    if (options?.preserveCDF && cdfSnapshot.length > 0) {
      const updateCDFByName = db.prepare(
        `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?
         WHERE session_id = ? AND component_id = ? AND name = ?`,
      );
      const updateCDFByPosition = db.prepare(
        `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?
         WHERE session_id = ? AND component_id = ? AND position = ? AND cdf_type IS NULL`,
      );
      const restoredPropKeys = new Set<string>();
      const unmatchedSnaps: CDFSnapshot[] = [];
      // First pass: match by name
      for (const snap of cdfSnapshot) {
        const result = updateCDFByName.run(
          snap.cdf_type,
          snap.cdf_category,
          snap.cdf_token_kind,
          sessionId,
          snap.component_id,
          snap.name,
        );
        if (Number(result.changes) > 0) {
          restoredPropKeys.add(`${snap.component_id}::${snap.name}`);
        } else {
          unmatchedSnaps.push(snap);
        }
      }
      // Second pass: for renamed props, fall back to position-based matching
      for (const snap of unmatchedSnaps) {
        const result = updateCDFByPosition.run(
          snap.cdf_type,
          snap.cdf_category,
          snap.cdf_token_kind,
          sessionId,
          snap.component_id,
          snap.position,
        );
        if (Number(result.changes) > 0) {
          const matched = db
            .prepare(`SELECT name FROM raw_props WHERE session_id = ? AND component_id = ? AND position = ?`)
            .get(sessionId, snap.component_id, snap.position) as { name: string } | undefined;
          if (matched) {
            restoredPropKeys.add(`${snap.component_id}::${matched.name}`);
          }
        }
      }

      const updateDesc = db.prepare(
        `UPDATE raw_components SET description = ? WHERE session_id = ? AND component_id = ?`,
      );
      for (const snap of descSnapshot) {
        updateDesc.run(snap.description, sessionId, snap.component_id);
      }

      // Restore allowed values only for props that still exist (to avoid FK violations)
      const relevantAV = avSnapshot.filter((av) => restoredPropKeys.has(`${av.component_id}::${av.prop_name}`));
      if (relevantAV.length > 0) {
        const deleteAV = db.prepare(
          `DELETE FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ? AND prop_name = ?`,
        );
        const insertAV = db.prepare(
          `INSERT OR IGNORE INTO raw_prop_allowed_values (session_id, component_id, prop_name, position, value)
           VALUES (?, ?, ?, ?, ?)`,
        );
        const deletedKeys = new Set<string>();
        for (const av of relevantAV) {
          const key = `${av.component_id}::${av.prop_name}`;
          if (!deletedKeys.has(key)) {
            deleteAV.run(sessionId, av.component_id, av.prop_name);
            deletedKeys.add(key);
          }
          insertAV.run(sessionId, av.component_id, av.prop_name, av.position, av.value);
        }
      }
    }

    if (options?.status) {
      db.prepare('UPDATE raw_components SET status = ? WHERE session_id = ?').run(options.status, sessionId);
    }
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export type RawComponentWithId = RawComponentDefinition & {
  component_id: string;
};

export function loadRawComponents(
  db: DatabaseSync,
  sessionId: string,
  allowedNames?: Set<string>,
): RawComponentWithId[] {
  const all = db
    .prepare(
      'SELECT component_id, name, source, framework, extraction_confidence, review_reasons, needs_review, source_path FROM raw_components WHERE session_id = ? ORDER BY rowid',
    )
    .all(sessionId) as Array<{
    component_id: string;
    name: string;
    source: string;
    framework: string;
    extraction_confidence: number | null;
    review_reasons: string;
    needs_review: number;
    source_path: string | null;
  }>;

  const components = allowedNames ? all.filter((c) => allowedNames.has(c.name)) : all;

  if (components.length === 0) return [];

  const props = db
    .prepare(
      `SELECT component_id, name, type, required, category, default_value, description, token_reference, position,
              rationale, source_start_line, source_end_line
       FROM raw_props WHERE session_id = ? ORDER BY component_id, position`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    name: string;
    type: string;
    required: number;
    category: string | null;
    default_value: string | null;
    description: string | null;
    token_reference: string | null;
    position: number;
    rationale: string | null;
    source_start_line: number | null;
    source_end_line: number | null;
  }>;

  const allowedValues = db
    .prepare(
      `SELECT component_id, prop_name, position, value
       FROM raw_prop_allowed_values WHERE session_id = ? ORDER BY component_id, prop_name, position`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    prop_name: string;
    position: number;
    value: string;
  }>;

  const slots = db
    .prepare(
      `SELECT component_id, name, is_default, description, position
       FROM raw_slots WHERE session_id = ? ORDER BY component_id, position`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    name: string;
    is_default: number;
    description: string | null;
    position: number;
  }>;

  const allowedComponents = db
    .prepare(
      `SELECT component_id, slot_name, position, allowed_component
       FROM raw_slot_allowed_components WHERE session_id = ? ORDER BY component_id, slot_name, position`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    slot_name: string;
    position: number;
    allowed_component: string;
  }>;

  // Group children by component_id
  const propsByComponent = groupBy(props, (p) => p.component_id);
  const allowedValuesByProp = groupBy(allowedValues, (av) => `${av.component_id}::${av.prop_name}`);
  const slotsByComponent = groupBy(slots, (s) => s.component_id);
  const allowedComponentsBySlot = groupBy(allowedComponents, (ac) => `${ac.component_id}::${ac.slot_name}`);

  return components.map(
    (c): RawComponentWithId => ({
      component_id: c.component_id,
      name: c.name,
      source: c.source,
      framework: c.framework as RawComponentDefinition['framework'],
      extractionConfidence: c.extraction_confidence ?? null,
      reviewReasons: (() => {
        try {
          return JSON.parse(c.review_reasons ?? '[]') as string[];
        } catch {
          return [];
        }
      })(),
      needsReview: Boolean(c.needs_review),
      sourcePath: c.source_path ?? undefined,
      props: (propsByComponent.get(c.component_id) ?? []).map((p): RawPropDefinition => {
        const av = allowedValuesByProp.get(`${c.component_id}::${p.name}`);
        const prop: RawPropDefinition = {
          name: p.name,
          type: p.type,
          required: Boolean(p.required),
        };
        if (p.category !== null) prop.category = p.category as RawPropDefinition['category'];
        if (p.default_value !== null) prop.defaultValue = p.default_value;
        if (p.description !== null) prop.description = p.description;
        if (p.token_reference !== null) prop.tokenReference = p.token_reference;
        if (av && av.length > 0) prop.allowedValues = av.map((v) => v.value);
        if (p.source_start_line !== null) prop.sourceStartLine = p.source_start_line;
        if (p.source_end_line !== null) prop.sourceEndLine = p.source_end_line;
        return prop;
      }),
      slots: (slotsByComponent.get(c.component_id) ?? []).map((s): RawSlotDefinition => {
        const ac = allowedComponentsBySlot.get(`${c.component_id}::${s.name}`);
        const slot: RawSlotDefinition = {
          name: s.name,
          isDefault: Boolean(s.is_default),
        };
        if (s.description !== null) slot.description = s.description;
        if (ac && ac.length > 0) slot.allowedComponents = ac.map((v) => v.allowed_component);
        return slot;
      }),
    }),
  );
}

/**
 * Rename empty-named slots in the DB to heuristic names before generation.
 * The LLM classify_slot tool call is matched back to the DB row by name, so a
 * row with name="" can never be updated by the LLM — renaming it here makes it
 * classifiable. Returns one warning string per renamed slot.
 */
export function renameEmptySlots(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  componentName: string,
  slotCount: number,
): { renames: Array<{ oldName: string; newName: string }>; warnings: string[] } {
  const emptySlots = db
    .prepare(
      `SELECT name, position FROM raw_slots
       WHERE session_id = ? AND component_id = ? AND trim(name) = ''
       ORDER BY position`,
    )
    .all(sessionId, componentId) as Array<{ name: string; position: number }>;

  if (emptySlots.length === 0) return { renames: [], warnings: [] };

  const renames: Array<{ oldName: string; newName: string }> = [];
  const warnings: string[] = [];

  const rename = db.prepare(
    `UPDATE raw_slots SET name = ? WHERE session_id = ? AND component_id = ? AND name = ? AND position = ?`,
  );

  // Multi-statement write — wrap in a transaction so a SIGINT or driver error
  // mid-loop leaves raw_slots either fully renamed or fully untouched, never
  // half-renamed (which would corrupt the prompt-vs-DB invariant the LLM
  // relies on for classify_slot). Matches the existing BEGIN/COMMIT pattern
  // throughout this file (see storeRawComponents, createStep, etc.).
  db.exec('BEGIN');
  try {
    for (const slot of emptySlots) {
      // Single unnamed slot → "children". Multiple → positional names.
      const newName = slotCount === 1 ? 'children' : `slot_${slot.position}`;
      rename.run(newName, sessionId, componentId, slot.name, slot.position);
      renames.push({ oldName: slot.name, newName });
      warnings.push(
        `${componentName}: slot at position ${slot.position} had empty name — renamed to "${newName}" for classification`,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { renames, warnings };
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    let arr = map.get(k);
    if (!arr) {
      arr = [];
      map.set(k, arr);
    }
    arr.push(item);
  }
  return map;
}

function deriveComponentId(name: string, source: string): string {
  return createHash('sha256').update(`${name}:${source}`).digest('hex').slice(0, 12);
}

export function storeCDFComponents(
  db: DatabaseSync,
  sessionId: string,
  components: Array<{ key: string; entry: CDFComponentEntry }>,
): void {
  const now = new Date().toISOString();

  const updateComp = db.prepare(
    `UPDATE raw_components SET status = 'generated', description = ? WHERE session_id = ? AND name = ?`,
  );
  const updateProp = db.prepare(
    `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?, required = ? WHERE session_id = ? AND component_id = ? AND name = ?`,
  );
  const deleteAllowedValues = db.prepare(
    `DELETE FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ? AND prop_name = ?`,
  );
  const insertAllowedValue = db.prepare(
    `INSERT INTO raw_prop_allowed_values (session_id, component_id, prop_name, value, position)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertAllowedComponent = db.prepare(
    `INSERT INTO raw_slot_allowed_components (session_id, component_id, slot_name, allowed_component, position)
     VALUES (?, ?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    for (const { key, entry } of components) {
      const row = db
        .prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?')
        .get(sessionId, key) as { component_id: string } | undefined;

      if (row) {
        const { component_id: componentId } = row;
        updateComp.run(entry.$description ?? null, sessionId, key);
        for (const [propName, prop] of Object.entries(entry.$properties)) {
          updateProp.run(
            prop.$type,
            prop.$category,
            prop['$token.kind'] ?? null,
            prop.$required ? 1 : 0,
            sessionId,
            componentId,
            propName,
          );
          if (prop.$values && prop.$values.length > 0) {
            deleteAllowedValues.run(sessionId, componentId, propName);
            prop.$values.forEach((v, i) => insertAllowedValue.run(sessionId, componentId, propName, v, i));
          }
        }
      } else {
        // Component not in raw_components (e.g. agent added a new one) — insert a minimal record
        const componentId = createHash('sha256').update(`${key}:generated`).digest('hex').slice(0, 12);
        db.prepare(
          `INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at, status, description)
           VALUES (?, ?, ?, '', 'react', ?, 'generated', ?)`,
        ).run(sessionId, componentId, key, now, entry.$description ?? null);

        let position = 0;
        for (const [propName, prop] of Object.entries(entry.$properties)) {
          db.prepare(
            `INSERT OR REPLACE INTO raw_props
               (session_id, component_id, name, type, required, category, default_value, description, token_reference, position, cdf_type, cdf_category, cdf_token_kind)
             VALUES (?, ?, ?, '', ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
          ).run(
            sessionId,
            componentId,
            propName,
            prop.$required ? 1 : 0,
            position++,
            prop.$type,
            prop.$category,
            prop['$token.kind'] ?? null,
          );
          if (prop.$values && prop.$values.length > 0) {
            prop.$values.forEach((v, i) => insertAllowedValue.run(sessionId, componentId, propName, v, i));
          }
        }

        let slotPos = 0;
        for (const [slotName, slot] of Object.entries(entry.$slots ?? {})) {
          db.prepare(
            `INSERT OR REPLACE INTO raw_slots
               (session_id, component_id, name, is_default, required, description, position)
             VALUES (?, ?, ?, 0, ?, ?, ?)`,
          ).run(sessionId, componentId, slotName, slot.$required ? 1 : 0, slot.$description ?? null, slotPos++);
          if (slot.$allowedComponents && slot.$allowedComponents.length > 0) {
            slot.$allowedComponents.forEach((ac, i) =>
              insertAllowedComponent.run(sessionId, componentId, slotName, ac, i),
            );
          }
        }
      }
    }

    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function loadCDFComponents(
  db: DatabaseSync,
  sessionId: string,
): Array<{ key: string; entry: CDFComponentEntry }> {
  const components = db
    .prepare(
      `SELECT component_id, name, description FROM raw_components
       WHERE session_id = ? AND status = 'generated' ORDER BY rowid`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    name: string;
    description: string | null;
  }>;

  if (components.length === 0) return [];

  const props = db
    .prepare(
      `SELECT component_id, name, required, default_value, description,
              cdf_type, cdf_category, cdf_token_kind, position
       FROM raw_props
       WHERE session_id = ? AND cdf_type IS NOT NULL AND cdf_type != 'excluded'
       ORDER BY component_id, position`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    name: string;
    required: number;
    default_value: string | null;
    description: string | null;
    cdf_type: string;
    cdf_category: string;
    cdf_token_kind: string | null;
    position: number;
  }>;

  const allowedValues = db
    .prepare(
      `SELECT component_id, prop_name, value, position
       FROM raw_prop_allowed_values WHERE session_id = ? ORDER BY component_id, prop_name, position`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    prop_name: string;
    value: string;
    position: number;
  }>;

  const slots = db
    .prepare(
      `SELECT component_id, name, description, required FROM raw_slots WHERE session_id = ? ORDER BY component_id, position`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    name: string;
    description: string | null;
    required: number;
  }>;

  const allowedComponents = db
    .prepare(
      `SELECT component_id, slot_name, allowed_component
       FROM raw_slot_allowed_components WHERE session_id = ? ORDER BY component_id, slot_name, position`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    slot_name: string;
    allowed_component: string;
  }>;

  const propsByComponent = groupBy(props, (p) => p.component_id);
  const allowedValuesByProp = groupBy(allowedValues, (av) => `${av.component_id}::${av.prop_name}`);
  const slotsByComponent = groupBy(slots, (s) => s.component_id);
  const allowedComponentsBySlot = groupBy(allowedComponents, (ac) => `${ac.component_id}::${ac.slot_name}`);

  return components
    .map(({ component_id, name, description }) => {
      const compProps = propsByComponent.get(component_id) ?? [];
      // NOTE: Components with zero CDF-classified props are intentionally
      // returned with an empty `$properties` object. Filtering them out here
      // silently dropped them from the wizard's final-review (INTEG-4257),
      // so the user couldn't see that the LLM had failed to classify anything
      // and couldn't reject the empty component. Surface them instead — the
      // wizard tags them with a ⚠ badge and an in-panel banner so the user
      // can manually add props in FieldEditor or reject the component.
      // Downstream consumers (buildManifest, push) tolerate empty $properties.

      const $properties: CDFComponentEntry['$properties'] = {};
      for (const p of compProps) {
        // Hallucination insurance: drop any prop whose name didn't survive trim.
        // The pre-generate rename guard catches empty-named slots, but if the LLM
        // hallucinated a classify_prop with an empty name into the DB, surface
        // nothing to the manifest builder rather than emitting "$properties: { '': ... }".
        if (!p.name.trim()) continue;
        const av = allowedValuesByProp.get(`${component_id}::${p.name}`);
        const propDef: CDFComponentEntry['$properties'][string] = {
          $type: p.cdf_type as CDFComponentEntry['$properties'][string]['$type'],
          $category: p.cdf_category as CDFComponentEntry['$properties'][string]['$category'],
        };
        if (p.required) propDef.$required = true;
        if (p.default_value !== null) {
          if (p.cdf_type === 'boolean') {
            propDef.$default = p.default_value === 'true';
          } else {
            propDef.$default = p.default_value;
          }
        }
        if (p.description !== null) propDef.$description = p.description;
        if (av && av.length > 0) propDef.$values = av.map((v) => v.value);
        if (p.cdf_token_kind !== null) propDef['$token.kind'] = p.cdf_token_kind;
        $properties[p.name] = propDef;
      }

      const compSlots = slotsByComponent.get(component_id) ?? [];
      const $slots: CDFComponentEntry['$slots'] = {};
      for (const s of compSlots) {
        // Hallucination insurance: same as $properties — drop empty-named slots
        // before they reach buildManifest, which faithfully passes empty keys
        // through and triggers a 422 from the preview API.
        if (!s.name.trim()) continue;
        const ac = allowedComponentsBySlot.get(`${component_id}::${s.name}`);
        const slotDef: NonNullable<CDFComponentEntry['$slots']>[string] = {};
        if (s.description !== null) slotDef.$description = s.description;
        if (s.required) slotDef.$required = true;
        if (ac && ac.length > 0) slotDef.$allowedComponents = ac.map((v) => v.allowed_component);
        $slots[s.name] = slotDef;
      }

      const entry: CDFComponentEntry = { $type: 'component', $properties };
      if (description !== null) entry.$description = description;
      if (Object.keys($slots).length > 0) entry.$slots = $slots;
      return { key: name, entry };
    });
}

export function loadScopeComponents(
  db: DatabaseSync,
  sessionId: string,
): Array<{ name: string; componentId: string }> {
  const rows = db
    .prepare(
      `SELECT name, component_id FROM raw_components
       WHERE session_id = ? AND status = 'extracted'
       ORDER BY name`,
    )
    .all(sessionId) as Array<{ name: string; component_id: string }>;
  return rows.map((r) => ({ name: r.name, componentId: r.component_id }));
}

export function applyScopeDecisions(
  db: DatabaseSync,
  sessionId: string,
  decisions: { accepted: string[]; rejected: string[] },
): void {
  const now = new Date().toISOString();
  const accepted = [...new Set(decisions.accepted)];
  if (accepted.length > 0) {
    const placeholders = accepted.map(() => '?').join(',');
    db.prepare(
      `UPDATE raw_components SET status = 'generated' WHERE session_id = ? AND name IN (${placeholders})`,
    ).run(sessionId, ...accepted);
  }
  // Rejected components are intentionally left at status='extracted'.
  // loadCDFComponents only picks up status='generated', so this is sufficient
  // to exclude them from generate / push without a destructive write.
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
}

export function storeDTCGTokens(
  db: DatabaseSync,
  sessionId: string,
  groups: DTCGTokenGroup[],
  tokens: DTCGTokenEntry[],
): void {
  const now = new Date().toISOString();

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM raw_token_groups WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM raw_tokens WHERE session_id = ?').run(sessionId);

    const insertGroup = db.prepare(`INSERT INTO raw_token_groups (session_id, path, description) VALUES (?, ?, ?)`);
    for (const group of groups) {
      insertGroup.run(sessionId, group.path, group.$description ?? null);
    }

    const insertToken = db.prepare(
      `INSERT INTO raw_tokens (session_id, path, type, value, description) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const token of tokens) {
      insertToken.run(sessionId, token.path, token.$type, JSON.stringify(token.$value), token.$description ?? null);
    }

    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export interface ApplyTokenToolCallsResult {
  tokens: number;
  groups: number;
  warnings: string[];
}

export function applyTokenToolCalls(
  db: DatabaseSync,
  sessionId: string,
  calls: TokenToolCall[],
  incomingWarnings: string[],
): ApplyTokenToolCallsResult {
  const now = new Date().toISOString();
  const warnings = [...incomingWarnings];
  let tokens = 0;
  let groups = 0;

  const upsertToken = db.prepare(
    `INSERT INTO raw_tokens (session_id, path, type, value, description) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id, path) DO UPDATE SET type = excluded.type, value = excluded.value, description = excluded.description`,
  );
  const upsertGroup = db.prepare(
    `INSERT INTO raw_token_groups (session_id, path, description) VALUES (?, ?, ?)
     ON CONFLICT(session_id, path) DO UPDATE SET description = excluded.description`,
  );

  db.exec('BEGIN');
  try {
    for (const call of calls) {
      if (call.tool === 'set_token') {
        upsertToken.run(sessionId, call.path, call.type, JSON.stringify(call.value), call.description ?? null);
        tokens++;
      } else if (call.tool === 'set_group') {
        upsertGroup.run(sessionId, call.path, call.description ?? null);
        groups++;
      }
    }
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { tokens, groups, warnings };
}

export function loadDTCGTokens(
  db: DatabaseSync,
  sessionId: string,
): { groups: DTCGTokenGroup[]; tokens: DTCGTokenEntry[] } {
  const groupRows = db
    .prepare('SELECT path, description FROM raw_token_groups WHERE session_id = ? ORDER BY path')
    .all(sessionId) as Array<{ path: string; description: string | null }>;

  const tokenRows = db
    .prepare('SELECT path, type, value, description FROM raw_tokens WHERE session_id = ? ORDER BY path')
    .all(sessionId) as Array<{
    path: string;
    type: string;
    value: string;
    description: string | null;
  }>;

  const groups: DTCGTokenGroup[] = groupRows.map((r) => {
    const prefix = `${r.path}.`;
    const tokenIds = tokenRows
      .filter((t) => t.path.startsWith(prefix) && !t.path.slice(prefix.length).includes('.'))
      .map((t) => t.path);
    const g: DTCGTokenGroup = { path: r.path, tokenIds };
    if (r.description !== null) g.$description = r.description;
    return g;
  });

  const tokens: DTCGTokenEntry[] = tokenRows.map((r) => {
    const t: DTCGTokenEntry = {
      path: r.path,
      $type: r.type as DTCGTokenEntry['$type'],
      $value: JSON.parse(r.value) as unknown,
    };
    if (r.description !== null) t.$description = r.description;
    return t;
  });

  return { groups, tokens };
}

export function findLatestSessionForCommand(db: DatabaseSync, command: CommandName): string | null {
  const row = db
    .prepare(
      `SELECT s.id FROM sessions s
       JOIN steps st ON st.session_id = s.id
       WHERE st.command = ? AND st.status = 'complete'
       ORDER BY st.started_at DESC, st.id DESC
       LIMIT 1`,
    )
    .get(command) as { id: string } | undefined;
  return row?.id ?? null;
}

export function seedCDFFromPriorSession(db: DatabaseSync, targetSessionId: string): number {
  // Find the most recent session (other than target) that has CDF data for any of the
  // target's component_ids. This works regardless of which command produced the CDF.
  const targetComponentIds = db
    .prepare(`SELECT component_id FROM raw_components WHERE session_id = ?`)
    .all(targetSessionId) as Array<{ component_id: string }>;

  if (targetComponentIds.length === 0) return 0;

  const placeholders = targetComponentIds.map(() => '?').join(',');
  const priorRow = db
    .prepare(
      `SELECT session_id FROM raw_props
       WHERE cdf_type IS NOT NULL AND session_id != ?
         AND component_id IN (${placeholders})
       ORDER BY rowid DESC LIMIT 1`,
    )
    .get(targetSessionId, ...targetComponentIds.map((r) => r.component_id)) as { session_id: string } | undefined;

  if (!priorRow) return 0;
  const priorSessionId = priorRow.session_id;

  // Copy CDF columns from prior session's props into matching props in the target session.
  const result = db
    .prepare(
      `UPDATE raw_props SET
       cdf_type = (SELECT p2.cdf_type FROM raw_props p2
                   WHERE p2.session_id = ? AND p2.component_id = raw_props.component_id
                   AND p2.name = raw_props.name AND p2.cdf_type IS NOT NULL),
       cdf_category = (SELECT p2.cdf_category FROM raw_props p2
                       WHERE p2.session_id = ? AND p2.component_id = raw_props.component_id
                       AND p2.name = raw_props.name AND p2.cdf_type IS NOT NULL),
       cdf_token_kind = (SELECT p2.cdf_token_kind FROM raw_props p2
                         WHERE p2.session_id = ? AND p2.component_id = raw_props.component_id
                         AND p2.name = raw_props.name AND p2.cdf_type IS NOT NULL)
     WHERE session_id = ? AND cdf_type IS NULL
       AND EXISTS (SELECT 1 FROM raw_props p2
                   WHERE p2.session_id = ? AND p2.component_id = raw_props.component_id
                   AND p2.name = raw_props.name AND p2.cdf_type IS NOT NULL)`,
    )
    .run(priorSessionId, priorSessionId, priorSessionId, targetSessionId, priorSessionId);

  // Also copy descriptions from prior session's components
  db.prepare(
    `UPDATE raw_components SET description = (
       SELECT c2.description FROM raw_components c2
       WHERE c2.session_id = ? AND c2.component_id = raw_components.component_id
       AND c2.description IS NOT NULL
     )
     WHERE session_id = ? AND description IS NULL
       AND EXISTS (SELECT 1 FROM raw_components c2
                   WHERE c2.session_id = ? AND c2.component_id = raw_components.component_id
                   AND c2.description IS NOT NULL)`,
  ).run(priorSessionId, targetSessionId, priorSessionId);

  // Copy allowed values for seeded props from prior session
  if (result.changes > 0) {
    db.prepare(
      `INSERT OR IGNORE INTO raw_prop_allowed_values (session_id, component_id, prop_name, position, value)
       SELECT ?, av.component_id, av.prop_name, av.position, av.value
       FROM raw_prop_allowed_values av
       WHERE av.session_id = ?
         AND EXISTS (SELECT 1 FROM raw_props p
                     WHERE p.session_id = ? AND p.component_id = av.component_id
                     AND p.name = av.prop_name AND p.cdf_type IS NOT NULL)`,
    ).run(targetSessionId, priorSessionId, targetSessionId);
  }

  return Number(result.changes);
}

export function seedCDFFromPreviewResponse(
  db: DatabaseSync,
  sessionId: string,
  removedItems: ComponentTypeSummary[],
): number {
  if (removedItems.length === 0) return 0;

  let totalSeeded = 0;

  const updateStmt = db.prepare(
    `UPDATE raw_props
     SET cdf_type = ?, cdf_category = ?
     WHERE session_id = ? AND component_id = ? AND name = ? AND cdf_type IS NULL`,
  );

  for (const item of removedItems) {
    if (!item.fullProperties) continue;

    const localComponent = db
      .prepare(`SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?`)
      .get(sessionId, item.name) as { component_id: string } | undefined;

    if (!localComponent) continue;

    const contentProps = new Set(item.contentProperties);
    const designProps = new Set(item.designProperties);

    for (const [propName, propSummary] of Object.entries(item.fullProperties)) {
      const cdfType = mapServerTypeToCDFType(propSummary.type);
      if (!cdfType) continue;

      let cdfCategory = propSummary.category || null;
      if (!cdfCategory || !['content', 'design', 'state'].includes(cdfCategory)) {
        if (contentProps.has(propName)) cdfCategory = 'content';
        else if (designProps.has(propName)) cdfCategory = 'design';
        else cdfCategory = 'state';
      }

      const result = updateStmt.run(cdfType, cdfCategory, sessionId, localComponent.component_id, propName);
      totalSeeded += Number(result.changes);
    }
  }

  return totalSeeded;
}

/**
 * Seeds server-side metadata for changed components:
 * 1. Fills in defaults the server has but we don't (prevents accidental removal)
 * 2. Seeds cdf_type/cdf_category for props that exist on server but lack CDF locally
 *    (e.g. props with non-standard source types the generation step couldn't classify)
 */
export function seedDefaultsFromChangedItems(
  db: DatabaseSync,
  sessionId: string,
  changedItems: Array<{ current: ComponentTypeSummary; proposed: object }>,
): number {
  if (changedItems.length === 0) return 0;

  let totalSeeded = 0;

  const updateDefaultStmt = db.prepare(
    `UPDATE raw_props SET default_value = ?
     WHERE session_id = ? AND component_id = ? AND name = ? AND default_value IS NULL`,
  );

  const updateCDFStmt = db.prepare(
    `UPDATE raw_props SET cdf_type = ?, cdf_category = ?
     WHERE session_id = ? AND component_id = ? AND name = ? AND cdf_type IS NULL`,
  );

  for (const { current } of changedItems) {
    if (!current.fullProperties) continue;

    const localComponent = db
      .prepare(`SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?`)
      .get(sessionId, current.name) as { component_id: string } | undefined;

    if (!localComponent) continue;

    const contentProps = new Set(current.contentProperties);
    const designProps = new Set(current.designProperties);

    for (const [propName, propSummary] of Object.entries(current.fullProperties)) {
      // Seed defaults
      if (propSummary.default !== undefined && propSummary.default !== null) {
        const defaultStr =
          typeof propSummary.default === 'string' ? propSummary.default : JSON.stringify(propSummary.default);
        const result = updateDefaultStmt.run(defaultStr, sessionId, localComponent.component_id, propName);
        totalSeeded += Number(result.changes);
      }

      // Seed CDF type/category for props that lack it
      const cdfType = mapServerTypeToCDFType(propSummary.type);
      if (!cdfType) continue;

      let cdfCategory = propSummary.category || null;
      if (!cdfCategory || !['content', 'design', 'state'].includes(cdfCategory)) {
        if (contentProps.has(propName)) cdfCategory = 'content';
        else if (designProps.has(propName)) cdfCategory = 'design';
        else cdfCategory = 'state';
      }

      const result = updateCDFStmt.run(cdfType, cdfCategory, sessionId, localComponent.component_id, propName);
      totalSeeded += Number(result.changes);
    }
  }

  return totalSeeded;
}

/**
 * Ensures all props on generated components have a cdf_type.
 * Uses the pre-classification `category` column when available.
 * Falls back to cdf_type: 'string', cdf_category: 'content' for props
 * with no pre-classification (safe default — content is the most common category).
 */
export function backfillUnclassifiedProps(db: DatabaseSync, sessionId: string): number {
  // First: backfill props that HAVE a pre-classification category
  const withCategory = db
    .prepare(
      `UPDATE raw_props SET cdf_type = 'string', cdf_category = category
     WHERE session_id = ? AND cdf_type IS NULL AND category IS NOT NULL
       AND component_id IN (
         SELECT component_id FROM raw_components WHERE session_id = ? AND status = 'generated'
       )`,
    )
    .run(sessionId, sessionId);

  // Second: backfill props with NO category (complex types the rules couldn't classify)
  const withoutCategory = db
    .prepare(
      `UPDATE raw_props SET cdf_type = 'string', cdf_category = 'content'
     WHERE session_id = ? AND cdf_type IS NULL AND category IS NULL
       AND component_id IN (
         SELECT component_id FROM raw_components WHERE session_id = ? AND status = 'generated'
       )`,
    )
    .run(sessionId, sessionId);

  return Number(withCategory.changes) + Number(withoutCategory.changes);
}

function mapServerTypeToCDFType(serverType: string): string | null {
  switch (serverType.toLowerCase()) {
    case 'string':
    case 'text':
      return 'string';
    case 'richtext':
      return 'richtext';
    case 'media':
      return 'media';
    case 'link':
      return 'link';
    case 'enum':
    case 'symbol':
      return 'enum';
    case 'token':
      return 'token';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

// ── Generation Cache ──────────────────────────────────────────────────────────

export interface CacheEntry {
  inputHash: string;
  entityType: 'component' | 'token_set';
  entityId: string;
  sourceSessionId: string;
  humanEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

export function computeComponentInputHash(component: RawComponentWithId): string {
  const payload = {
    framework: component.framework,
    name: component.name,
    props: component.props.map((p) => ({
      allowedValues: p.allowedValues ?? [],
      defaultValue: p.defaultValue ?? null,
      description: p.description ?? null,
      name: p.name,
      required: p.required,
      tokenReference: p.tokenReference ?? null,
      type: p.type,
    })),
    slots: component.slots.map((s) => ({
      allowedComponents: s.allowedComponents ?? [],
      description: s.description ?? null,
      isDefault: s.isDefault,
      name: s.name,
    })),
    source: component.source,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function computeTokenInputHash(rawTokenContent: string): string {
  return createHash('sha256').update(rawTokenContent.trim()).digest('hex');
}

export function lookupCache(
  db: DatabaseSync,
  inputHash: string,
  entityType: 'component' | 'token_set',
  entityId: string,
): CacheEntry | null {
  const row = db
    .prepare(
      `SELECT input_hash, entity_type, entity_id, source_session_id, human_edited, created_at, updated_at
       FROM generation_cache
       WHERE input_hash = ? AND entity_type = ? AND entity_id = ?`,
    )
    .get(inputHash, entityType, entityId) as
    | {
        input_hash: string;
        entity_type: string;
        entity_id: string;
        source_session_id: string;
        human_edited: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    inputHash: row.input_hash,
    entityType: row.entity_type as 'component' | 'token_set',
    entityId: row.entity_id,
    sourceSessionId: row.source_session_id,
    humanEdited: row.human_edited === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function lookupCacheByEntity(
  db: DatabaseSync,
  entityType: 'component' | 'token_set',
  entityId: string,
): CacheEntry | null {
  const row = db
    .prepare(
      `SELECT input_hash, entity_type, entity_id, source_session_id, human_edited, created_at, updated_at
       FROM generation_cache
       WHERE entity_type = ? AND entity_id = ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(entityType, entityId) as
    | {
        input_hash: string;
        entity_type: string;
        entity_id: string;
        source_session_id: string;
        human_edited: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    inputHash: row.input_hash,
    entityType: row.entity_type as 'component' | 'token_set',
    entityId: row.entity_id,
    sourceSessionId: row.source_session_id,
    humanEdited: row.human_edited === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function storeCache(
  db: DatabaseSync,
  inputHash: string,
  entityType: 'component' | 'token_set',
  entityId: string,
  sourceSessionId: string,
  humanEdited: boolean,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO generation_cache (input_hash, entity_type, entity_id, source_session_id, human_edited, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(input_hash, entity_type, entity_id) DO UPDATE SET
       source_session_id = excluded.source_session_id,
       human_edited = CASE WHEN generation_cache.human_edited = 1 THEN 1 ELSE excluded.human_edited END,
       updated_at = excluded.updated_at`,
  ).run(inputHash, entityType, entityId, sourceSessionId, humanEdited ? 1 : 0, now, now);
}

export function storeScannedFiles(db: DatabaseSync, sessionId: string, filePaths: string[]): void {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM scanned_files WHERE session_id = ?').run(sessionId);
    const insert = db.prepare('INSERT INTO scanned_files (session_id, path) VALUES (?, ?)');
    for (const path of filePaths) {
      insert.run(sessionId, path);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function loadScannedFiles(db: DatabaseSync, sessionId: string): string[] {
  const rows = db.prepare('SELECT path FROM scanned_files WHERE session_id = ? ORDER BY path').all(sessionId) as Array<{
    path: string;
  }>;
  return rows.map((r) => r.path);
}

export function markCacheHumanEdited(db: DatabaseSync, entityType: 'component' | 'token_set', entityId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE generation_cache SET human_edited = 1, updated_at = ? WHERE entity_type = ? AND entity_id = ?`,
  ).run(now, entityType, entityId);
}

export function copyComponentFromCache(
  db: DatabaseSync,
  sourceSessionId: string,
  targetSessionId: string,
  componentId: string,
): void {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const srcComp = db
      .prepare(`SELECT description, status FROM raw_components WHERE session_id = ? AND component_id = ?`)
      .get(sourceSessionId, componentId) as { description: string | null; status: string } | undefined;

    if (srcComp) {
      db.prepare(
        `UPDATE raw_components SET description = ?, status = ?, extracted_at = ? WHERE session_id = ? AND component_id = ?`,
      ).run(srcComp.description, srcComp.status, now, targetSessionId, componentId);
    }

    const srcProps = db
      .prepare(
        `SELECT name, cdf_type, cdf_category, cdf_token_kind, required, description, default_value
         FROM raw_props WHERE session_id = ? AND component_id = ?`,
      )
      .all(sourceSessionId, componentId) as Array<{
      name: string;
      cdf_type: string | null;
      cdf_category: string | null;
      cdf_token_kind: string | null;
      required: number;
      description: string | null;
      default_value: string | null;
    }>;

    for (const p of srcProps) {
      db.prepare(
        `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?, required = ?, description = ?, default_value = ?
         WHERE session_id = ? AND component_id = ? AND name = ?`,
      ).run(
        p.cdf_type,
        p.cdf_category,
        p.cdf_token_kind,
        p.required,
        p.description,
        p.default_value,
        targetSessionId,
        componentId,
        p.name,
      );
    }

    db.prepare(`DELETE FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ?`).run(
      targetSessionId,
      componentId,
    );
    const srcAV = db
      .prepare(
        `SELECT prop_name, position, value FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ?`,
      )
      .all(sourceSessionId, componentId) as Array<{
      prop_name: string;
      position: number;
      value: string;
    }>;
    const insertAV = db.prepare(
      `INSERT INTO raw_prop_allowed_values (session_id, component_id, prop_name, position, value) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const av of srcAV) {
      insertAV.run(targetSessionId, componentId, av.prop_name, av.position, av.value);
    }

    const srcSlots = db
      .prepare(`SELECT name, required, description FROM raw_slots WHERE session_id = ? AND component_id = ?`)
      .all(sourceSessionId, componentId) as Array<{
      name: string;
      required: number;
      description: string | null;
    }>;
    for (const s of srcSlots) {
      db.prepare(
        `UPDATE raw_slots SET required = ?, description = ? WHERE session_id = ? AND component_id = ? AND name = ?`,
      ).run(s.required, s.description, targetSessionId, componentId, s.name);
    }

    db.prepare(`DELETE FROM raw_slot_allowed_components WHERE session_id = ? AND component_id = ?`).run(
      targetSessionId,
      componentId,
    );
    const srcSAC = db
      .prepare(
        `SELECT slot_name, position, allowed_component FROM raw_slot_allowed_components WHERE session_id = ? AND component_id = ?`,
      )
      .all(sourceSessionId, componentId) as Array<{
      slot_name: string;
      position: number;
      allowed_component: string;
    }>;
    const insertSAC = db.prepare(
      `INSERT INTO raw_slot_allowed_components (session_id, component_id, slot_name, allowed_component, position) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const sac of srcSAC) {
      insertSAC.run(targetSessionId, componentId, sac.slot_name, sac.allowed_component, sac.position);
    }

    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, targetSessionId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function copyTokensFromCache(db: DatabaseSync, sourceSessionId: string, targetSessionId: string): void {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM raw_tokens WHERE session_id = ?').run(targetSessionId);
    db.prepare('DELETE FROM raw_token_groups WHERE session_id = ?').run(targetSessionId);

    db.prepare(
      `INSERT INTO raw_token_groups (session_id, path, description)
       SELECT ?, path, description FROM raw_token_groups WHERE session_id = ?`,
    ).run(targetSessionId, sourceSessionId);

    db.prepare(
      `INSERT INTO raw_tokens (session_id, path, type, value, description)
       SELECT ?, path, type, value, description FROM raw_tokens WHERE session_id = ?`,
    ).run(targetSessionId, sourceSessionId);

    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, targetSessionId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
