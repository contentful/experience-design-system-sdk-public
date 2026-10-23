import {
  initializeRepresentationSchema,
  prepareEntryRepresentationPlans,
  saveEntryRepresentationPlans,
  overlayRepresentationPlans,
  selectedRepresentationValidity,
  assertPreservedRepresentationSelections,
  expandRepresentationClosure,
  loadReviewCDFComponents,
  loadRepresentationPlans,
  representationContext,
  saveGeneratedRepresentationPlan,
} from './representation-plans.js';
import {
  definitionCall,
  reviewRepresentationProposal,
} from '../../../../steps/generation/src/services/property/definition-call.js';
import { validateSavedSourceClosure } from './source-closure-binding.js';
import { validateSavedFieldReplay } from './field-replay-binding.js';
import {
  validateCDFProperty,
  validateSourceGraph,
  normalizeClassificationCalls,
  accountClassificationCalls,
  jsonEqual,
  jsonValueIssue,
  cloneJson,
  own,
  propertyDefinitionImportBlockers,
  validateRepresentationPlan,
  modelExplorationComplete,
  type RepresentationPlan,
  type RepresentationProposalDraft,
  type CDFPropertyDefinition,
  type ClassifiedPropertyCall,
} from '@contentful/experience-design-system-types';
import { componentDecisionInventory } from '../../../../steps/generation/src/services/property/decision-inventory.js';
import { materializeProperty } from '../../../../steps/generation/src/services/property/materialize-property.js';
import {
  buildSharedSource,
  projectSharedSource,
  projectCapturedFile,
  findSourceOwnerFile,
} from '../../../../source-evidence/shared-source.js';
import type { SharedSource } from '@contentful/experience-design-system-types';
import { initializeExplorationSchema } from './exploration/schema.js';
import { withTransaction } from './shared/with-transaction.js';
import {
  loadAcceptedSlotDecisions,
  loadExplorationRun,
  loadExplorationReports,
  loadExplorationRecord,
  saveReviewedSlots,
} from './exploration/records.js';
import type {
  DerivedSelection,
  SlotDecision,
  ExplorationDetailRecord,
} from '@contentful/experience-design-system-types';
import { projectAcceptedSlots } from '../../../../steps/exploration/src/services/project-accepted-slots.js';
import { validateCDFSourceOwners } from '../../../../steps/exploration/src/services/source-input-ownership.js';
import { validateSavedInputOutput } from './input-output-binding.js';
import { createCapturedLocationBinder } from './captured-file-lookup.js';
import { mapSourceObservationLocations } from '../../../../steps/extraction/src/component-facts/map-source-observation-locations.js';
import { hasBoundComponentDeclaration } from '../../../../steps/extraction/src/component-facts/component-declaration-binding.js';
import { bindSavedSourceReferences } from './source-reference-binding.js';
import { readSourceInventory, readSourceReferences } from '../../../../steps/extraction/index.js';
import { CDFComponentSchema } from '@contentful/experience-design-system-types';
import { readComponentFacts, readComponentFactsJson, type ComponentFactsRead } from './component-facts-validation.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { configRoot } from '../helpers/config-root.js';
import { dirname, resolve } from 'node:path';
import type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
} from '../../../../steps/extraction/src/types/component.js';
import type { CDFComponentEntry } from '../../../../steps/shared/index.js';
import type { ToolCall, ComponentSourceRef } from '../../../../agents/index.js';
import type { ComponentTypeSummary } from '../../../../steps/shared/index.js';
import type { SlotCycle, SlotEdge } from '../../../../steps/composition/src/types/graph.js';
import { deriveComponentId } from '../helpers/components/derive-component-id.js';
import { mapContentfulTypeToCdfType, resolveCdfCategory } from '../helpers/cdf/cdf-mappers.js';
import { indexRowsByKey } from '../helpers/shared/index-rows-by-key.js';
import { getLatestCompletedSessionForCommand, type MatchHints as SessionMatchHints } from './sessions/read.js';
import { updateSessionTimestamp } from './sessions/write.js';
import { getSessionIdForStep } from './steps/read.js';
import { createPendingStep, updatePendingStepsToInterrupted, updateStepStatus } from './steps/write.js';
import { getOrCreateSessionForCommand, type SessionResolution } from '../services/session-resolver.js';
import { pruneObsoleteIncompleteStepsIfNeeded } from './step-history-migration.js';
import { getRawTokenNamePaths, type RawTokenNamePathSource } from './tokens/read.js';
import { type RawPropTokenPathSource } from './tokens/write.js';
import {
  isSourceCandidatePayload,
  isAlternateSourcePayload,
  isExtractionDiagnosticsPayload,
} from './source-evidence-validation.js';
import type { SourceCapture } from '../../../../steps/extraction/index.js';
import {
  bindSourceCandidatesToCapture,
  bindCompilerReadsToCapture,
  SUPPORTED_SOURCE_FACT_SCHEMA_VERSIONS,
} from '../../../../steps/extraction/index.js';
import type {
  ExtractionDiagnostics,
  SourceCandidate,
  SourceCandidateSource,
} from '../../../../steps/extraction/index.js';

export { hashComponentShape as computeComponentInputHash } from '../helpers/components/hash-component-shape.js';
export { hashTokenContent as computeTokenInputHash } from '../helpers/tokens/hash-token-content.js';

// Tokens — repositories/tokens/{read,write}.ts and services/tokens/*
export {
  getDtcgTokensForSession as loadDTCGTokens,
  getRawTokenNamePaths as loadRawTokenNamePaths,
  getRawTokenNamePathRows as loadRawTokenNamePathRows,
} from './tokens/read.js';
export { storeDtcgTokens as storeDTCGTokens } from '../services/tokens/store-dtcg-tokens.js';
export { applyTokenToolCalls } from '../services/tokens/apply-tool-calls.js';
export { replaceRawTokenNamePaths } from '../services/tokens/replace-raw-token-name-paths.js';
export { replaceRawPropTokenPaths } from '../services/tokens/replace-raw-prop-token-paths.js';

export type CommandName =
  | 'analyze extract'
  | 'analyze select'
  | 'generate components'
  | 'generate tokens'
  | 'apply'
  | 'print components'
  | 'print tokens'
  | 'map tokens'
  | 'fetch existing entities'
  | 'import';

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

CREATE TABLE IF NOT EXISTS raw_component_source_evidence (
  session_id          TEXT NOT NULL,
  component_id        TEXT NOT NULL,
  fact_schema_version INTEGER,
  candidates_json     TEXT,
  alternate_sources_json TEXT,
  component_facts_json TEXT,
  PRIMARY KEY (session_id, component_id),
  FOREIGN KEY (session_id, component_id) REFERENCES raw_components(session_id, component_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS extraction_source_diagnostics (
  session_id  TEXT NOT NULL PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL
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
  dom_attribute     INTEGER CHECK (dom_attribute IN (0, 1)),
  PRIMARY KEY (session_id, component_id, name),
  FOREIGN KEY (session_id, component_id) REFERENCES raw_components(session_id, component_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raw_component_decisions (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (session_id, component_id),
  FOREIGN KEY (session_id, component_id) REFERENCES raw_components(session_id, component_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raw_property_decisions (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL,
  prop_name TEXT NOT NULL,
  revision INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  PRIMARY KEY (session_id, component_id, prop_name),
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
  entity_type       TEXT NOT NULL CHECK (entity_type IN ('component', 'token_set', 'token_mapping')),
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

CREATE TABLE IF NOT EXISTS slot_cycles (
  session_id             TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  cycle_index            INTEGER NOT NULL,
  path_json              TEXT NOT NULL,
  edges_json             TEXT NOT NULL,
  suggested_break_json   TEXT,
  PRIMARY KEY (session_id, cycle_index)
);

CREATE TABLE IF NOT EXISTS session_source_envelopes (
  envelope_id  TEXT NOT NULL PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  step_id      INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  digest       TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (session_id, step_id)
);

CREATE TRIGGER IF NOT EXISTS session_source_envelopes_immutable
BEFORE UPDATE ON session_source_envelopes
BEGIN
  SELECT RAISE(ABORT, 'source envelopes are immutable');
END;

CREATE TABLE IF NOT EXISTS scope_decisions (
  session_id      TEXT NOT NULL,
  component_id    TEXT NOT NULL,
  component_name  TEXT NOT NULL,
  decision        TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  provenance_json TEXT,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (session_id, component_id),
  FOREIGN KEY (session_id, component_id)
    REFERENCES raw_components(session_id, component_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raw_prop_token_paths (
  session_id   TEXT NOT NULL,
  component_id TEXT NOT NULL,
  prop_name    TEXT NOT NULL,
  -- Who set this list. 'agent' is a map-tokens suggestion, which a later
  -- run of that step may freely revise. 'review' is a person's decision
  -- in the review editor, which a re-run must not overwrite.
  source       TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'review')),
  position     INTEGER NOT NULL,
  path         TEXT NOT NULL,
  PRIMARY KEY (session_id, component_id, prop_name, position),
  FOREIGN KEY (session_id, component_id, prop_name)
    REFERENCES raw_props(session_id, component_id, name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS raw_token_name_paths (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  raw_name   TEXT NOT NULL,
  path       TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('automatic', 'manual')),
  PRIMARY KEY (session_id, raw_name)
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
  return resolve(configRoot(), 'pipeline.db');
}

export function openPipelineDb(dbPath?: string): DatabaseSync {
  const path = dbPath ?? getPipelineDbPath();
  mkdirSync(dirname(path), { recursive: true });
  try {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec(SCHEMA);
    initializeExplorationSchema(db);
    initializeRepresentationSchema(db);
    applyDbMigrations(db);
    pruneObsoleteIncompleteStepsIfNeeded(db);
    return db;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('database is locked')) {
      throw new Error('database is locked: another CLI process may be running. Retry once it exits.');
    }
    throw e;
  }
}

function applyDbMigrations(db: DatabaseSync): void {
  const evidenceCols = db.prepare('PRAGMA table_info(raw_component_source_evidence)').all() as Array<{ name: string }>;
  if (!evidenceCols.some((column) => column.name === 'component_facts_json')) {
    db.exec('ALTER TABLE raw_component_source_evidence ADD COLUMN component_facts_json TEXT');
  }
  const cols = db.prepare('PRAGMA table_info(raw_slots)').all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === 'required')) {
    db.exec('ALTER TABLE raw_slots ADD COLUMN required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1))');
  }

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
  if (!rawPropColNames.has('dom_attribute')) {
    db.exec('ALTER TABLE raw_props ADD COLUMN dom_attribute INTEGER CHECK (dom_attribute IN (0, 1))');
  }

  const rawPropsDdl = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'raw_props'`).get() as
    | { sql: string }
    | undefined;
  if (rawPropsDdl && !rawPropsDdl.sql.includes(`'unattached'`)) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      try {
        db.exec(`
        CREATE TABLE raw_props__new (
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
          cdf_category      TEXT CHECK (cdf_category IN ('content', 'design', 'state', 'unattached')),
          cdf_token_kind    TEXT,
          rationale         TEXT,
          source_start_line INTEGER,
          source_end_line   INTEGER,
          dom_attribute     INTEGER CHECK (dom_attribute IN (0, 1)),
          PRIMARY KEY (session_id, component_id, name),
          FOREIGN KEY (session_id, component_id) REFERENCES raw_components(session_id, component_id) ON DELETE CASCADE
        );

        INSERT INTO raw_props__new
          (session_id, component_id, name, type, required, category, default_value,
           description, token_reference, position, cdf_type, cdf_category, cdf_token_kind,
           rationale, source_start_line, source_end_line, dom_attribute)
        SELECT
          session_id, component_id, name, type, required, category, default_value,
          description, token_reference, position, cdf_type, cdf_category, cdf_token_kind,
          rationale, source_start_line, source_end_line, dom_attribute
        FROM raw_props;

        DROP TABLE raw_props;
        ALTER TABLE raw_props__new RENAME TO raw_props;
        CREATE INDEX IF NOT EXISTS idx_raw_props_session ON raw_props(session_id, component_id);

        UPDATE raw_props
        SET cdf_category = 'unattached',
            cdf_type = CASE WHEN type = 'boolean' THEN 'boolean' ELSE 'string' END,
            required = 0
        WHERE cdf_type = 'excluded';
      `);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  const tokenPathCols = db.prepare('PRAGMA table_info(raw_prop_token_paths)').all() as Array<{ name: string }>;
  if (tokenPathCols.length > 0 && !tokenPathCols.some((c) => c.name === 'source')) {
    // Pre-existing rows predate the review editor writing its own lists, so they
    // can only have come from map tokens — the 'agent' default is correct for them.
    db.exec(
      "ALTER TABLE raw_prop_token_paths ADD COLUMN source TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'review'))",
    );
  }

  if (!rawCompColNames.has('reject_reason')) {
    db.exec('ALTER TABLE raw_components ADD COLUMN reject_reason TEXT');
  }

  if (!rawCompColNames.has('component_description_rationale')) {
    db.exec('ALTER TABLE raw_components ADD COLUMN component_description_rationale TEXT');
  }
  if (!rawCompColNames.has('props_rationale')) {
    db.exec('ALTER TABLE raw_components ADD COLUMN props_rationale TEXT');
  }
  if (!rawCompColNames.has('slots_rationale')) {
    db.exec('ALTER TABLE raw_components ADD COLUMN slots_rationale TEXT');
  }
  const rawSlotColsForRationale = db.prepare('PRAGMA table_info(raw_slots)').all() as Array<{ name: string }>;
  if (!rawSlotColsForRationale.some((c) => c.name === 'rationale')) {
    db.exec('ALTER TABLE raw_slots ADD COLUMN rationale TEXT');
  }

  const hasExtractCache = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='extract_cache'`)
    .all() as Array<{ name: string }>;
  if (hasExtractCache.length === 0) {
    db.exec(`
      CREATE TABLE extract_cache (
        file_path        TEXT NOT NULL,
        file_hash        TEXT NOT NULL,
        cli_version      TEXT NOT NULL,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        components_json  TEXT NOT NULL,
        PRIMARY KEY (file_hash, cli_version)
      );
      CREATE INDEX idx_extract_cache_file ON extract_cache(file_path);
    `);
  }

  const hasSelectCache = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='select_cache'`)
    .all() as Array<{ name: string }>;
  if (hasSelectCache.length === 0) {
    db.exec(`
      CREATE TABLE select_cache (
        component_hash TEXT NOT NULL,
        prompt_hash    TEXT NOT NULL,
        cli_version    TEXT NOT NULL,
        decision       TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
        reason         TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        PRIMARY KEY (component_hash, prompt_hash, cli_version)
      );
    `);
  }

  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='generation_cache'`)
    .all() as Array<{ name: string }>;
  if (tables.length === 0) {
    db.exec(`
      CREATE TABLE generation_cache (
        input_hash        TEXT NOT NULL,
        entity_type       TEXT NOT NULL CHECK (entity_type IN ('component', 'token_set', 'token_mapping')),
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

  const genCacheCols = db.prepare(`PRAGMA table_info(generation_cache)`).all() as Array<{ name: string; pk: number }>;
  const hasPromptHash = genCacheCols.some((c) => c.name === 'prompt_hash');
  const oldPkCols = genCacheCols.filter((c) => c.pk > 0).map((c) => c.name);
  const promptHashInPk = oldPkCols.includes('prompt_hash');
  if (!hasPromptHash) {
    db.exec(`ALTER TABLE generation_cache ADD COLUMN prompt_hash TEXT NOT NULL DEFAULT ''`);
  }
  if (!promptHashInPk) {
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE generation_cache__new (
          input_hash        TEXT NOT NULL,
          entity_type       TEXT NOT NULL CHECK (entity_type IN ('component', 'token_set', 'token_mapping')),
          entity_id         TEXT NOT NULL,
          source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          human_edited      INTEGER NOT NULL DEFAULT 0 CHECK (human_edited IN (0, 1)),
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL,
          prompt_hash       TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (input_hash, prompt_hash, entity_type, entity_id)
        );
        INSERT INTO generation_cache__new
          (input_hash, entity_type, entity_id, source_session_id, human_edited, created_at, updated_at, prompt_hash)
          SELECT input_hash, entity_type, entity_id, source_session_id, human_edited, created_at, updated_at, prompt_hash
          FROM generation_cache;
        DROP TABLE generation_cache;
        ALTER TABLE generation_cache__new RENAME TO generation_cache;
        CREATE INDEX IF NOT EXISTS idx_generation_cache_entity  ON generation_cache(entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS idx_generation_cache_session ON generation_cache(source_session_id);
      `);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const genCacheTableSql = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'generation_cache'`)
    .get() as { sql: string } | undefined;
  const hasTokenMappingEntityType = genCacheTableSql?.sql.includes("'token_mapping'") ?? true;
  if (!hasTokenMappingEntityType) {
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE generation_cache__new2 (
          input_hash        TEXT NOT NULL,
          entity_type       TEXT NOT NULL CHECK (entity_type IN ('component', 'token_set', 'token_mapping')),
          entity_id         TEXT NOT NULL,
          source_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          human_edited      INTEGER NOT NULL DEFAULT 0 CHECK (human_edited IN (0, 1)),
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL,
          prompt_hash       TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (input_hash, prompt_hash, entity_type, entity_id)
        );
        INSERT INTO generation_cache__new2
          (input_hash, entity_type, entity_id, source_session_id, human_edited, created_at, updated_at, prompt_hash)
          SELECT input_hash, entity_type, entity_id, source_session_id, human_edited, created_at, updated_at, prompt_hash
          FROM generation_cache;
        DROP TABLE generation_cache;
        ALTER TABLE generation_cache__new2 RENAME TO generation_cache;
        CREATE INDEX IF NOT EXISTS idx_generation_cache_entity  ON generation_cache(entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS idx_generation_cache_session ON generation_cache(source_session_id);
      `);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const hasCompositionCache = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='composition_cache'`)
    .all() as Array<{ name: string }>;
  if (hasCompositionCache.length === 0) {
    db.exec(`
      CREATE TABLE composition_cache (
        input_hash   TEXT NOT NULL,
        cli_version  TEXT NOT NULL,
        agent_output TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        PRIMARY KEY (input_hash, cli_version)
      );
    `);
  }
}

export interface ApplyToolCallsResult {
  classified: number;
  excluded: number;
  slots: number;
  warnings: string[];
  projectionBlocked?: boolean;
}

export interface ApplyToolCallsOptions {
  /** Component names that may appear in generated slot allowed-components lists. */
  allowedComponentNames?: ReadonlySet<string>;
  representationPlans?: ReadonlyMap<string, RepresentationPlan>;
}

export interface ComponentReviewMetadata {
  exploration?: { inclusion?: DerivedSelection; slots: SlotDecision[]; detail?: ExplorationDetailRecord };
  sourcePath: string | null;
  componentSource: string | null;
  sourceCoverage: SourceCapture['coverage'];
  extractionByteBinding: SourceCapture['extractionByteBinding'];
  sourceTextHash: string | null;
  sourceCompilerContext?: NonNullable<SharedSource['compilerContexts']>[number];
  sourceLineRanges: Array<{ sourceStartLine: number; sourceEndLine: number; displayStartLine: number }>;
  scopeProvenance: ScopeDecisionProvenance | null;
  props: Record<
    string,
    {
      rationale: string | null;
      sourceStartLine: number | null;
      sourceEndLine: number | null;
      sourceCandidate: SourceCandidate | null;
    }
  >;
  componentEvidenceReadStatus?: NonNullable<RawComponentDefinition['componentEvidenceReadStatus']>;
  componentFacts?: RawComponentDefinition['componentFacts'] | null;
  sourceEvidenceReadStatus: NonNullable<RawComponentDefinition['sourceEvidenceReadStatus']>;
  sourceCandidates: SourceCandidate[] | null;
  sourceCandidateSources: SourceCandidateSource[] | null;
  extractionDiagnostics: ExtractionSourceDiagnosticsRead;
}

export function loadComponentReviewMetadata(
  db: DatabaseSync,
  sessionId: string,
  componentName: string,
  componentId?: string,
): ComponentReviewMetadata | null {
  const rows = db
    .prepare('SELECT component_id,source,source_path FROM raw_components WHERE session_id=? AND name=?')
    .all(sessionId, componentName) as Array<{ component_id: string; source: string; source_path: string | null }>;
  const matches = componentId ? rows.filter((row) => row.component_id === componentId) : rows;
  if (matches.length > 1) throw new Error('Ambiguous review metadata component');
  const compRow = matches[0];
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

  const rawComponent = loadRawComponents(db, sessionId, new Set([componentName])).find(
    (component) => component.component_id === compRow.component_id,
  );
  const candidatesByName = new Map(
    (rawComponent?.sourceCandidates ?? []).map((candidate) => [candidate.name, candidate]),
  );
  const props: ComponentReviewMetadata['props'] = Object.create(null) as ComponentReviewMetadata['props'];
  for (const r of propRows) {
    props[r.name] = {
      rationale: r.rationale,
      sourceStartLine: r.source_start_line,
      sourceEndLine: r.source_end_line,
      sourceCandidate: candidatesByName.get(r.name) ?? null,
    };
  }

  let sourcePath: string | null = compRow.source_path;
  let componentSource: string | null = null;
  let sourceCoverage: SourceCapture['coverage'] = 'unavailable';
  let extractionByteBinding: SourceCapture['extractionByteBinding'] = 'unverified';
  let sourceTextHash: string | null = null;
  let sourceCompilerContext: ComponentReviewMetadata['sourceCompilerContext'];
  let sourceLineRanges: ComponentReviewMetadata['sourceLineRanges'] = [];
  const scopeProvenance = loadScopeDecisions(db, sessionId)?.acceptedProvenance?.[componentName] ?? null;
  const saved = loadCompletedSourceEvidence(db, sessionId);
  if (saved.readiness === 'ready') {
    const file = findSourceOwnerFile(
      saved.envelope.capture,
      compRow.component_id,
      compRow.source_path ?? rawComponent?.source,
    );
    if (file) {
      const shared = loadSavedSharedSource(db, sessionId, { componentIds: [compRow.component_id] });
      const projected =
        shared.readiness === 'ready' ? shared.source.files.find((entry) => entry.fileId === file.fileId) : undefined;
      const projection = {
        text: projected?.coverage === 'unavailable' ? null : (projected?.content ?? null),
        ranges: (projected?.ranges ?? []).map((range) => ({
          sourceStartLine: range.startLine,
          sourceEndLine: range.endLine,
          displayStartLine: range.displayStartLine,
        })),
      };
      sourcePath = file.displayPath;
      componentSource = projection.text;
      sourceCoverage = shared.readiness === 'ready' ? (shared.source.promptCoverage ?? 'partial') : 'unavailable';
      extractionByteBinding = saved.envelope.extractionByteBinding;
      sourceTextHash = file.textHash;
      sourceLineRanges = projection.ranges;
      sourceCompilerContext =
        shared.readiness === 'ready'
          ? shared.source.compilerContexts?.find((context) => context.contextId === file.compilerContextId)
          : undefined;
    }
  }

  return {
    ...(loadExplorationRun(db, sessionId, 'components')
      ? {
          exploration: {
            inclusion: loadExplorationRecord<DerivedSelection[]>(db, sessionId, 'components', 'inclusion')?.find(
              (decision) => decision.componentId === compRow.component_id,
            ),
            slots: (loadAcceptedSlotDecisions(db, sessionId) ?? []).filter(
              (slot) => slot.componentId === compRow.component_id,
            ),
            detail: loadExplorationRecord<ExplorationDetailRecord>(db, sessionId, 'detail', 'detail'),
          },
        }
      : {}),
    sourcePath,
    componentSource,
    sourceCoverage,
    extractionByteBinding,
    sourceTextHash,
    ...(sourceCompilerContext ? { sourceCompilerContext } : {}),
    sourceLineRanges,
    scopeProvenance,
    props,
    componentEvidenceReadStatus: rawComponent?.componentEvidenceReadStatus ?? 'unknown-legacy',
    componentFacts:
      rawComponent?.componentEvidenceReadStatus === 'available' ? (rawComponent.componentFacts ?? null) : null,
    sourceEvidenceReadStatus: rawComponent?.sourceEvidenceReadStatus ?? 'unknown-legacy',
    sourceCandidates:
      rawComponent?.sourceEvidenceReadStatus === 'available' ? (rawComponent.sourceCandidates ?? []) : null,
    sourceCandidateSources:
      rawComponent?.sourceEvidenceReadStatus === 'available' ? (rawComponent.sourceCandidateSources ?? []) : null,
    extractionDiagnostics: loadExtractionSourceDiagnostics(db, sessionId),
  };
}

export interface ComponentRationale {
  name: string;
  description: string | null;
  descriptionRationale: string | null;
  propsRationale: string | null;
  slotsRationale: string | null;
  props: Array<{
    name: string;
    category: string | null;
    description: string | null;
    rationale: string | null;
  }>;
  slots: Array<{
    name: string;
    description: string | null;
    rationale: string | null;
  }>;
}

export function loadComponentRationale(
  db: DatabaseSync,
  sessionId: string,
  componentName: string,
  componentId?: string,
): ComponentRationale | null {
  const matches = db
    .prepare(
      `SELECT component_id, name, description, component_description_rationale, props_rationale, slots_rationale
       FROM raw_components WHERE session_id = ? AND name = ? AND (? IS NULL OR component_id = ?)`,
    )
    .all(sessionId, componentName, componentId ?? null, componentId ?? null) as Array<{
    component_id: string;
    name: string;
    description: string | null;
    component_description_rationale: string | null;
    props_rationale: string | null;
    slots_rationale: string | null;
  }>;
  if (matches.length > 1) throw new Error('Ambiguous component rationale');
  const compRow = matches[0];
  if (!compRow) return null;

  const propRows = db
    .prepare(
      `SELECT name, cdf_category, category, description, rationale FROM raw_props
       WHERE session_id = ? AND component_id = ? ORDER BY position`,
    )
    .all(sessionId, compRow.component_id) as Array<{
    name: string;
    cdf_category: string | null;
    category: string | null;
    description: string | null;
    rationale: string | null;
  }>;

  const slotRows = db
    .prepare(
      `SELECT name, description, rationale FROM raw_slots
       WHERE session_id = ? AND component_id = ? ORDER BY position`,
    )
    .all(sessionId, compRow.component_id) as Array<{
    name: string;
    description: string | null;
    rationale: string | null;
  }>;

  return {
    name: compRow.name,
    description: compRow.description,
    descriptionRationale: compRow.component_description_rationale,
    propsRationale: compRow.props_rationale,
    slotsRationale: compRow.slots_rationale,
    props: propRows.map((p) => ({
      name: p.name,
      category: p.cdf_category ?? p.category ?? null,
      description: p.description,
      rationale: p.rationale,
    })),
    slots: slotRows.map((s) => ({
      name: s.name,
      description: s.description,
      rationale: s.rationale,
    })),
  };
}

function savePropertyDecision(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  definition: CDFPropertyDefinition | null,
  decision: unknown,
): void {
  const validation = definition === null ? { valid: true, issues: [] } : validateCDFProperty(definition);
  if (!validation.valid)
    throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  const unsafe = jsonValueIssue(decision);
  if (unsafe) throw new Error(`${unsafe.path}: ${unsafe.message}`);
  const previous = db
    .prepare(
      'SELECT definition_json,decision_json FROM raw_property_decisions WHERE session_id=? AND component_id=? AND prop_name=?',
    )
    .get(sessionId, componentId, propName) as { definition_json: string; decision_json: string } | undefined;
  let retained = decision;
  if (previous && decision && typeof decision === 'object' && 'kind' in decision && decision.kind === 'review') {
    const prior = JSON.parse(previous.decision_json) as Record<string, unknown>;
    const priorDefinition = JSON.parse(previous.definition_json) as CDFPropertyDefinition | null;
    if (jsonEqual(priorDefinition, definition)) return;
    if (
      definition &&
      priorDefinition &&
      definition.$type === priorDefinition.$type &&
      own(prior, 'defaultIntent') &&
      own(definition, '$default') === own(priorDefinition, '$default') &&
      jsonEqual(definition.$default, priorDefinition.$default)
    )
      decision = { ...decision, defaultIntent: prior.defaultIntent };
    const analysis =
      prior.analysis ??
      Object.fromEntries(
        ['model', 'projection', 'alternatives'].filter((key) => own(prior, key)).map((key) => [key, prior[key]]),
      );
    retained = { ...(decision as Record<string, unknown>), analysis };
  }
  db.prepare(
    `INSERT INTO raw_property_decisions (session_id,component_id,prop_name,revision,definition_json,decision_json)
    VALUES (?,?,?,1,?,?) ON CONFLICT(session_id,component_id,prop_name) DO UPDATE SET revision=revision+1,definition_json=excluded.definition_json,decision_json=excluded.decision_json`,
  ).run(sessionId, componentId, propName, JSON.stringify(definition), JSON.stringify(retained));
}
export function loadPropertyDecisions(
  db: DatabaseSync,
  sessionId: string,
): Array<{
  componentId: string;
  propertyName: string;
  revision: number;
  definition: CDFPropertyDefinition | null;
  decision: unknown;
}> {
  const rows = db
    .prepare(
      'SELECT component_id,prop_name,revision,definition_json,decision_json FROM raw_property_decisions WHERE session_id=? ORDER BY component_id,prop_name',
    )
    .all(sessionId) as Array<{
    component_id: string;
    prop_name: string;
    revision: number;
    definition_json: string;
    decision_json: string;
  }>;
  return rows.map((row) => {
    const definition: unknown = JSON.parse(row.definition_json);
    if (definition !== null && !validateCDFProperty(definition).valid)
      throw new Error('Corrupt saved property definition');
    return {
      componentId: row.component_id,
      propertyName: row.prop_name,
      revision: row.revision,
      definition: definition as CDFPropertyDefinition | null,
      decision: JSON.parse(row.decision_json) as unknown,
    };
  });
}

export interface ComponentDecisionReadiness {
  componentId: string;
  accounting: { complete: boolean; missing: string[]; issues: string[] };
  source: { adequate: boolean; issues: string[] };
  definition: { ready: boolean; issues: string[] };
  import: { ready: boolean; issues: string[] };
}

export function evaluateComponentReadiness(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
): ComponentDecisionReadiness {
  const components = loadRawComponents(db, sessionId).filter((component) => component.component_id === componentId);
  if (components.length !== 1) throw new Error('Unknown or ambiguous selected component ID');
  const component = components[0]!;
  let slotIssue: string | undefined;
  let acceptedSlots: SlotDecision[] | undefined;
  try {
    acceptedSlots = loadAcceptedSlotDecisions(db, sessionId);
  } catch (error) {
    slotIssue = error instanceof Error ? error.message : 'Slot source unavailable';
  }
  const inventory = componentDecisionInventory(component, acceptedSlots);
  const row = db
    .prepare('SELECT payload_json FROM raw_component_decisions WHERE session_id=? AND component_id=?')
    .get(sessionId, componentId) as { payload_json: string } | undefined;
  let calls: ToolCall[] = [];
  const protocolIssues: string[] = [];
  let savedSource: unknown;
  let savedInventory: unknown;
  if (row) {
    const payload = JSON.parse(row.payload_json) as { calls?: unknown[]; source?: unknown; inventory?: unknown };
    savedSource = payload.source;
    savedInventory = payload.inventory;
    const normalized = normalizeClassificationCalls(payload.calls ?? []);
    calls = normalized.calls;
    protocolIssues.push(...normalized.warnings);
  }
  const decisions = loadPropertyDecisions(db, sessionId).filter((decision) => decision.componentId === componentId);
  const effective = calls.map((call) => {
    if (call.tool !== 'classify_prop') return call;
    const saved = decisions.find((decision) => decision.propertyName === call.prop);
    if (!saved?.definition) return call;
    const definition = saved.definition;
    const record = saved.decision as {
      defaultIntent?: ClassifiedPropertyCall['default_intent'];
      call?: ClassifiedPropertyCall;
    };
    return definitionCall(
      call.prop,
      definition,
      record.defaultIntent,
      record.call?.representation_proposal,
      record.call,
    );
  });
  const accounting = accountClassificationCalls(inventory, effective);
  const sourceIssues: string[] = slotIssue ? [slotIssue] : [];
  const importIssues: string[] = [];
  const representations = selectedRepresentationValidity(db, sessionId, componentId);
  const selectedPlans = loadRepresentationPlans(db, sessionId, componentId);
  const definitionIssues: string[] = [...representations.issues];
  if (!jsonEqual(savedSource, component.sourceCandidates ?? null))
    sourceIssues.push('Stale component source decision snapshot');
  if (!jsonEqual(savedInventory, inventory)) sourceIssues.push('Stale component subject inventory');
  const completed = loadCompletedSourceEvidence(db, sessionId);
  if (completed.readiness !== 'ready') sourceIssues.push('Completed bound source unavailable');
  else if (!completed.envelope.candidateDigests?.[componentId])
    sourceIssues.push('Completed candidate source binding unavailable');
  if (component.sourceEvidenceReadStatus !== 'available') sourceIssues.push('Candidate source evidence unavailable');
  for (const name of inventory.properties) {
    const excluded = effective.some((call) => call.tool === 'exclude_prop' && call.prop === name);
    const candidate = component.sourceCandidates?.find((item) => item.name === name);
    const fact = candidate?.facts;
    const locations = fact
      ? excluded
        ? fact.declarations
        : [
            ...fact.declarations,
            ...(fact.sourceGraph?.nodes.flatMap((node) => [
              ...node.declarations,
              ...(node.fields?.flatMap((field) => field.declarations ?? []) ?? []),
            ]) ?? []),
            ...(fact.sourceDefault?.location ? [fact.sourceDefault.location] : []),
            ...(fact.sourceDefault?.dependencies ?? []),
          ]
      : [];
    if (
      (!excluded &&
        (!fact?.sourceGraph ||
          validateSourceGraph(fact.sourceGraph).length ||
          fact.sourceGraph.coverage !== 'complete-within-declared-bound')) ||
      !locations.length ||
      locations.some((location) => location.binding !== 'verified')
    )
      sourceIssues.push(`Source inadequate for ${name}`);
    if (completed.readiness === 'ready')
      for (const location of locations) {
        const file = completed.envelope.capture.files.find(
          (item) => item.canonicalPath === location.canonicalPath && item.textHash === location.textHash,
        );
        if (
          !file ||
          !location.startLine ||
          !location.endLine ||
          location.endLine < location.startLine ||
          (file.captured.kind === 'full' &&
            (location.endLine > file.captured.text.split('\n').length ||
              (location.startOffset !== undefined &&
                location.startOffset !== null &&
                (location.startOffset < 0 ||
                  location.endOffset === null ||
                  location.endOffset === undefined ||
                  location.endOffset < location.startOffset ||
                  location.endOffset > file.captured.text.length))))
        )
          sourceIssues.push(`Source range unavailable for ${name}`);
      }
  }
  for (const call of effective) {
    if (call.tool !== 'classify_prop') continue;
    const saved = decisions.find((decision) => decision.propertyName === call.prop);
    if (!saved) {
      importIssues.push(`Missing durable property decision ${call.prop}`);
      definitionIssues.push(`Missing durable property decision ${call.prop}`);
      continue;
    }
    if (selectedPlans.some((row) => row.propertyName === call.prop)) {
      if (representations.heldProperties.has(call.prop))
        importIssues.push(`Representation prerequisites unavailable ${call.prop}`);
      continue;
    }
    if (saved.definition?.$type === 'token') {
      const paths = db
        .prepare(
          'SELECT path FROM raw_prop_token_paths WHERE session_id=? AND component_id=? AND prop_name=? ORDER BY position',
        )
        .all(sessionId, componentId, call.prop) as Array<{ path: string }>;
      if (new Set(paths.map((item) => item.path)).size !== paths.length)
        importIssues.push(`Duplicate token mapping ${call.prop}`);
      for (const item of paths) {
        const token = db
          .prepare('SELECT type FROM raw_tokens WHERE session_id=? AND path=?')
          .get(sessionId, item.path) as { type: string } | undefined;
        if (token && token.type !== saved.definition['$token.kind'])
          importIssues.push(`Changed token mapping ${call.prop}`);
      }
    }
    try {
      const record = saved.decision as {
        reviewAuthority?: unknown;
        model?: { identity?: unknown; source?: { originalFacts?: unknown } };
      };
      const authority = record.reviewAuthority;
      const current = materializeProperty(component, call, componentId, {
        defaultAuthority: authority ? 'review' : 'generation',
      });
      if (
        record.model &&
        (!jsonEqual(record.model.identity, current.model?.identity) ||
          !jsonEqual(record.model.source?.originalFacts, current.model?.source.originalFacts))
      )
        throw new Error('Stale saved property source model');
      if (authority && !jsonEqual(authority, current.model?.identity))
        throw new Error('Stale review default authority');
      if (!current.definition || !current.projection || !['supported', 'lossy'].includes(current.projection.outcome)) {
        importIssues.push(`Property held ${call.prop}`);
        definitionIssues.push(`Property held ${call.prop}`);
      }
      if (current.definition) importIssues.push(...propertyDefinitionImportBlockers(current.definition, call.prop));
    } catch (error) {
      const issue = error instanceof Error ? error.message : 'Invalid current property decision';
      importIssues.push(issue);
      definitionIssues.push(issue);
    }
  }
  const accountingIssues = [...protocolIssues, ...accounting.issues];
  const complete = accounting.complete && !protocolIssues.length;
  return {
    componentId,
    accounting: { complete, missing: accounting.missing, issues: accountingIssues },
    source: { adequate: !sourceIssues.length, issues: sourceIssues },
    definition: { ready: complete && !sourceIssues.length && !definitionIssues.length, issues: definitionIssues },
    import: {
      ready: complete && !sourceIssues.length && !definitionIssues.length && !importIssues.length,
      issues: [...definitionIssues, ...importIssues],
    },
  };
}

export function loadSelectedCDFComponents(
  db: DatabaseSync,
  sessionId: string,
  selectedIds?: ReadonlySet<string>,
  selectedKeys?: ReadonlySet<string>,
  purpose: 'import' | 'definition' = 'import',
): Array<{ key: string; componentId: string; entry: CDFComponentEntry }> {
  const rows = db
    .prepare('SELECT component_id,name,status FROM raw_components WHERE session_id=? ORDER BY rowid')
    .all(sessionId) as Array<{ component_id: string; name: string; status: string }>;
  const reviewRows = loadReviewCDFComponents(db, sessionId);
  if (selectedKeys) {
    const resolved = new Set<string>();
    for (const key of selectedKeys) {
      const matches = reviewRows.filter((row) => row.key === key);
      if (matches.length !== 1) throw new Error('Unknown or ambiguous selected component key');
      resolved.add(matches[0]!.componentId);
    }
    if (selectedIds && !jsonEqual([...selectedIds].sort(), [...resolved].sort()))
      throw new Error('Selected component keys and IDs disagree');
    selectedIds = resolved;
  }
  const scope = loadScopeDecisions(db, sessionId);
  const ids =
    selectedIds ??
    new Set(
      rows
        .filter((row) => row.status !== 'generate-rejected' && (!scope || scope.accepted.includes(row.name)))
        .map((row) => row.component_id),
    );
  for (const id of ids) {
    const selected = reviewRows.find((row) => row.componentId === id);
    if (!selected) throw new Error('Unknown selected component identity');
    if (selected.entry.$model && !ids.has(selected.entry.$model.componentId))
      throw new Error(`Selected model ${selected.key} requires its owning component`);
  }
  const rootIds = new Set([...ids].filter((id) => !reviewRows.find((row) => row.componentId === id)!.entry.$model));
  for (const id of rootIds) {
    const readiness = evaluateComponentReadiness(db, sessionId, id);
    if (!readiness[purpose].ready)
      throw new Error(
        `Selected component ${id} is not ready: ${[...readiness.accounting.issues, ...readiness.accounting.missing, ...readiness.source.issues, ...readiness.import.issues].join('; ')}`,
      );
  }
  const components = loadCDFComponents(db, sessionId).filter((component) => rootIds.has(component.componentId));
  if (components.length !== rootIds.size) throw new Error('Selected component output missing');
  return expandRepresentationClosure(components);
}

export function applyToolCalls(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  componentName: string,
  calls: ToolCall[],
  incomingWarnings: string[],
  options: ApplyToolCallsOptions = {},
): ApplyToolCallsResult {
  const now = new Date().toISOString();
  const warnings = [...incomingWarnings];
  let classified = 0;
  let excluded = 0;
  let slots = 0;
  let projectionBlocked = false;
  const matches = loadRawComponents(db, sessionId).filter((component) => component.component_id === componentId);
  if (matches.length !== 1 || matches[0]!.name !== componentName)
    throw new Error('Unknown or ambiguous component identity');
  const rawComponent = matches[0]!;
  const normalized = normalizeClassificationCalls(calls);
  if (incomingWarnings.length || normalized.warnings.length)
    throw new Error([...incomingWarnings, ...normalized.warnings].join('; '));
  const inventory = componentDecisionInventory(rawComponent, loadAcceptedSlotDecisions(db, sessionId));
  const accounting = accountClassificationCalls(inventory, normalized.calls);
  if (!accounting.complete)
    throw new Error([...accounting.issues, ...accounting.missing.map((key) => `Missing decision ${key}`)].join('; '));
  calls = normalized.calls;
  const reviewed = loadPropertyDecisions(db, sessionId).filter(
    (decision) => decision.componentId === componentId && (decision.decision as { kind?: string }).kind === 'review',
  );
  const retainedHuman = reviewed.filter((decision) => {
    if ((decision.decision as { transfer?: { state?: string } }).transfer?.state === 'stale')
      throw new Error('Source-changed human decision requires review');
    const incoming = calls.find((call) => call.tool === 'classify_prop' && call.prop === decision.propertyName);
    if (incoming?.tool === 'classify_prop' && incoming.representation_selection && decision.definition) {
      if (!materializeProperty(rawComponent, incoming, componentId).selectedRepresentationPlan)
        throw new Error('Replacement model representation is incomplete');
      return false;
    }
    if (incoming?.tool !== 'classify_prop' || !incoming.cdf_type || !decision.definition) return true;
    if (incoming.cdf_type === decision.definition.$type) return true;
    materializeProperty(rawComponent, incoming, componentId);
    return false;
  });
  calls = calls.map((call) => {
    if (call.tool !== 'classify_prop' && call.tool !== 'exclude_prop') return call;
    const human = retainedHuman.find((decision) => decision.propertyName === call.prop);
    if (!human) return call;
    if ((human.decision as { transfer?: { state?: string } }).transfer?.state === 'stale')
      throw new Error('Source-changed human decision requires review');
    if (!human.definition) return (human.decision as { call?: ToolCall }).call ?? call;
    const retained = definitionCall(
      call.prop,
      human.definition,
      (human.decision as { defaultIntent?: ClassifiedPropertyCall['default_intent'] }).defaultIntent,
      (human.decision as { call?: ClassifiedPropertyCall }).call?.representation_proposal,
      (human.decision as { call?: ClassifiedPropertyCall }).call,
    );
    materializeProperty(rawComponent, retained, componentId, { defaultAuthority: 'review' });
    return retained;
  });
  const sourceSnapshot = cloneJson(rawComponent.sourceCandidates ?? null);
  const producer = { kind: 'generation' as const, id: randomUUID(), sessionId, componentId };

  const updateProp = db.prepare(
    `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?, required = ?, description = ?, rationale = ?
     WHERE session_id = ? AND component_id = ? AND name = ?`,
  );
  const clearProp = db.prepare(
    `UPDATE raw_props
     SET cdf_type = NULL,
         cdf_category = NULL,
         cdf_token_kind = NULL,
         rationale = ?
     WHERE session_id = ? AND component_id = ? AND name = ?`,
  );
  const deleteTokenPaths = db.prepare(
    `DELETE FROM raw_prop_token_paths WHERE session_id = ? AND component_id = ? AND prop_name = ?`,
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
        if (call.rationale) {
          if (call.rationale.description !== undefined) {
            db.prepare(
              'UPDATE raw_components SET component_description_rationale = ? WHERE session_id = ? AND component_id = ?',
            ).run(call.rationale.description, sessionId, componentId);
          }
          if (call.rationale.props !== undefined) {
            db.prepare('UPDATE raw_components SET props_rationale = ? WHERE session_id = ? AND component_id = ?').run(
              call.rationale.props,
              sessionId,
              componentId,
            );
          }
          if (call.rationale.slots !== undefined) {
            db.prepare('UPDATE raw_components SET slots_rationale = ? WHERE session_id = ? AND component_id = ?').run(
              call.rationale.slots,
              sessionId,
              componentId,
            );
          }
        }
      } else if (call.tool === 'classify_prop') {
        if (!inventory.properties.includes(call.prop)) {
          warnings.push(`${componentName}: classify_prop '${call.prop}' — prop not found, skipped`);
          continue;
        }
        const human = retainedHuman.find((decision) => decision.propertyName === call.prop);
        if (call.representation_selection) deleteTokenPaths.run(sessionId, componentId, call.prop);
        const materialized = materializeProperty(rawComponent, call, componentId, {
          defaultAuthority: human ? 'review' : 'generation',
          ...(call.representation_selection
            ? { representationContext: representationContext(db, sessionId, componentId, call.prop) }
            : {}),
        });
        if (materialized.selectedRepresentationPlan) {
          const plan = options.representationPlans?.get(call.prop) ?? materialized.selectedRepresentationPlan;
          if (options.representationPlans) {
            if (!options.representationPlans.has(call.prop) || !modelExplorationComplete(plan))
              throw new Error('Generated model exploration is incomplete');
            const issues = validateRepresentationPlan(
              plan,
              materialized.model!,
              representationContext(db, sessionId, componentId, call.prop),
            );
            if (issues.length) throw new Error(issues.map((issue) => issue.message).join('; '));
            materialized.selectedRepresentationPlan = plan;
            materialized.representationPlans = materialized.representationPlans?.map((candidate) =>
              candidate.kind === 'component-model' ? plan : candidate,
            );
          }
          if (inventory.slots.some((slot) => slot.name === plan.attachment?.slot))
            throw new Error('Source slot and generated model attachment collide');
          clearProp.run(call.reason ?? null, sessionId, componentId, call.prop);
          savePropertyDecision(db, sessionId, componentId, call.prop, null, {
            kind: 'generation',
            producer,
            admission: 'component-model',
            defaultIntent: materialized.model!.defaultIntent,
            ...materialized,
          });
          saveGeneratedRepresentationPlan(db, sessionId, componentId, plan, producer);
          classified++;
          continue;
        }
        const definition = materialized.definition;
        if (
          !definition ||
          (materialized.projection && !['supported', 'lossy'].includes(materialized.projection.outcome))
        ) {
          projectionBlocked = true;
          clearProp.run(call.reason ?? 'Representation held', sessionId, componentId, call.prop);
          savePropertyDecision(db, sessionId, componentId, call.prop, definition, {
            kind: 'generation',
            producer,
            admission: 'unsupported',
            defaultIntent:
              call.default_intent ??
              (own(call, 'default') ? { action: 'set', value: call.default } : { action: 'absent' }),
            source: sourceSnapshot,
            ...materialized,
          });
          warnings.push(
            ...(materialized.projection?.issues ?? []).map((issue) => `${call.prop}${issue.path}: ${issue.message}`),
          );
          classified++;
          continue;
        }
        if (materialized.projection)
          warnings.push(
            ...(materialized.projection?.issues ?? []).map((issue) => `${call.prop}${issue.path}: ${issue.message}`),
          );
        const changes = updateProp.run(
          definition.$type,
          definition.$category,
          definition['$token.kind'] ?? null,
          definition.$required ? 1 : 0,
          definition.$description ?? null,
          call.reason ?? null,
          sessionId,
          componentId,
          call.prop,
        ) as { changes: number };
        if (changes.changes === 0) {
          warnings.push(`${componentName}: classify_prop '${call.prop}' — prop not found, skipped`);
          continue;
        }
        if (call.cdf_type !== 'token') deleteTokenPaths.run(sessionId, componentId, call.prop);
        if (!human)
          savePropertyDecision(db, sessionId, componentId, call.prop, definition, {
            kind: 'generation',
            producer,
            defaultIntent:
              call.default_intent ??
              (own(call, 'default') ? { action: 'set', value: call.default } : { action: 'absent' }),
            ...materialized,
          });
        classified++;
      } else if (call.tool === 'exclude_prop') {
        clearProp.run(call.reason || null, sessionId, componentId, call.prop);
        const excludedSource = materializeProperty(
          rawComponent,
          { tool: 'classify_prop', prop: call.prop, cdf_category: 'content', reason: call.reason },
          componentId,
        );
        savePropertyDecision(db, sessionId, componentId, call.prop, null, {
          kind: 'generation',
          producer,
          disposition: 'exclude',
          reason: call.reason,
          call,
          source: sourceSnapshot,
          identity: excludedSource.model?.identity ?? null,
          model: excludedSource.model ?? null,
          defaultIntent: { action: 'absent' },
        });
        excluded++;
      } else if (call.tool === 'classify_slot') {
        if (loadAcceptedSlotDecisions(db, sessionId) !== undefined) {
          slots++;
          continue;
        }
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
        if (call.rationale !== undefined) {
          db.prepare('UPDATE raw_slots SET rationale = ? WHERE session_id = ? AND component_id = ? AND name = ?').run(
            call.rationale,
            sessionId,
            componentId,
            call.slot,
          );
        }
        if (call.allowed_components !== undefined) {
          deleteAllowedComponents.run(sessionId, componentId, call.slot);
          const allowedComponents = options.allowedComponentNames
            ? call.allowed_components.filter((allowedComponent) => options.allowedComponentNames!.has(allowedComponent))
            : call.allowed_components;
          if (options.allowedComponentNames) {
            const dropped = [
              ...new Set(call.allowed_components.filter((ac) => !options.allowedComponentNames!.has(ac))),
            ];
            for (const allowedComponent of dropped) {
              warnings.push(
                `${componentName}: classify_slot '${call.slot}' — dropped unknown allowed component '${allowedComponent}'`,
              );
            }
          }
          allowedComponents.forEach((ac, i) => insertAllowedComponent.run(sessionId, componentId, call.slot, ac, i));
        }
        slots++;
      }
    }

    db.prepare(
      'INSERT INTO raw_component_decisions(session_id,component_id,payload_json) VALUES (?,?,?) ON CONFLICT(session_id,component_id) DO UPDATE SET payload_json=excluded.payload_json',
    ).run(
      sessionId,
      componentId,
      JSON.stringify({ schemaVersion: 1, calls, inventory, source: sourceSnapshot, accountingComplete: true }),
    );
    assertPreservedRepresentationSelections(db, sessionId, componentId);
    const currentReadiness = evaluateComponentReadiness(db, sessionId, componentId);
    if (!currentReadiness.source.adequate) {
      projectionBlocked = true;
      warnings.push(...currentReadiness.source.issues);
    }
    db.prepare(`UPDATE raw_components SET status = ?, extracted_at = ? WHERE session_id = ? AND component_id = ?`).run(
      projectionBlocked ? 'held' : 'generated',
      now,
      sessionId,
      componentId,
    );
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return { classified, excluded, slots, warnings, ...(projectionBlocked ? { projectionBlocked: true } : {}) };
}

export type MatchHints = SessionMatchHints;
export type { SessionResolution };

export function getOrCreateSession(
  db: DatabaseSync,
  sessionFlag: string | undefined,
  sessionName: string | undefined,
  hints: MatchHints,
): SessionResolution {
  return getOrCreateSessionForCommand(db, sessionFlag, sessionName, hints);
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
    updatePendingStepsToInterrupted(db, sessionId, command, now);
    const stepId = createPendingStep(db, sessionId, command, inputs, now);
    updateSessionTimestamp(db, sessionId, now);
    db.exec('COMMIT');
    return stepId;
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
  options?: { withinTransaction?: boolean },
): void {
  const now = new Date().toISOString();
  const ownsTransaction = !options?.withinTransaction;
  if (ownsTransaction) db.exec('BEGIN');
  try {
    const stepSessionId = getSessionIdForStep(db, stepId);
    updateStepStatus(db, stepId, status, outputs, error ?? null, now);
    if (stepSessionId) {
      updateSessionTimestamp(db, stepSessionId, now);
    }
    if (ownsTransaction) db.exec('COMMIT');
  } catch (e) {
    if (ownsTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

export function storeRawComponents(
  db: DatabaseSync,
  sessionId: string,
  components: RawComponentDefinition[],
  options?: {
    status?: string;
    preserveCDF?: boolean;
    preserveStatus?: boolean;
    withinTransaction?: boolean;
    extractionDiagnostics?: ExtractionDiagnostics;
  },
): void {
  const now = new Date().toISOString();

  const insertComp = db.prepare(
    `INSERT INTO raw_components (session_id, component_id, name, source, framework, extracted_at, review_reasons, needs_review, source_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSourceEvidence = db.prepare(
    `INSERT INTO raw_component_source_evidence
       (session_id, component_id, fact_schema_version, candidates_json, alternate_sources_json, component_facts_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertProp = db.prepare(
    `INSERT INTO raw_props
       (session_id, component_id, name, type, required, category, default_value, description, token_reference, position, source_start_line, source_end_line, dom_attribute)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  const ownsTransaction = !options?.withinTransaction;
  if (ownsTransaction) db.exec('BEGIN');
  try {
    const nativeSnapshot = options?.preserveCDF
      ? (db
          .prepare(
            'SELECT component_id,prop_name,revision,definition_json,decision_json FROM raw_property_decisions WHERE session_id=?',
          )
          .all(sessionId) as Array<{
          component_id: string;
          prop_name: string;
          revision: number;
          definition_json: string;
          decision_json: string;
        }>)
      : [];
    const ledgerSnapshot = options?.preserveCDF
      ? (db
          .prepare('SELECT component_id,payload_json FROM raw_component_decisions WHERE session_id=?')
          .all(sessionId) as Array<{ component_id: string; payload_json: string }>)
      : [];
    const tokenSnapshot = options?.preserveCDF
      ? (db
          .prepare('SELECT component_id,prop_name,source,position,path FROM raw_prop_token_paths WHERE session_id=?')
          .all(sessionId) as Array<{
          component_id: string;
          prop_name: string;
          source: string;
          position: number;
          path: string;
        }>)
      : [];
    const descriptionSnapshot = options?.preserveCDF
      ? (db.prepare('SELECT component_id,description FROM raw_components WHERE session_id=?').all(sessionId) as Array<{
          component_id: string;
          description: string | null;
        }>)
      : [];
    type StatusSnapshot = { component_id: string; status: string; reject_reason: string | null };
    let statusSnapshot: StatusSnapshot[] = [];
    if (options?.preserveStatus) {
      statusSnapshot = db
        .prepare(
          `SELECT component_id, status, reject_reason
           FROM raw_components WHERE session_id = ?`,
        )
        .all(sessionId) as StatusSnapshot[];
    }

    if (!options?.preserveCDF)
      db.prepare('DELETE FROM selected_representation_plans WHERE session_id = ?').run(sessionId);
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
        JSON.stringify(comp.reviewReasons ?? []),
        comp.needsReview ? 1 : 0,
        comp.sourcePath ?? null,
      );

      if (
        comp.factSchemaVersion !== undefined ||
        comp.sourceCandidates !== undefined ||
        comp.sourceCandidateSources !== undefined ||
        comp.componentFacts !== undefined
      ) {
        insertSourceEvidence.run(
          sessionId,
          componentId,
          comp.factSchemaVersion ?? null,
          comp.sourceCandidates === undefined ? null : JSON.stringify(comp.sourceCandidates),
          comp.sourceCandidateSources === undefined ? null : JSON.stringify(comp.sourceCandidateSources),
          comp.componentFacts === undefined
            ? null
            : jsonValueIssue(comp.componentFacts)
              ? 'null'
              : JSON.stringify(comp.componentFacts),
        );
      }

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
          prop.domAttribute === undefined ? null : prop.domAttribute ? 1 : 0,
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

    const transferred = new Map<string, ToolCall[]>();
    for (const snapshot of nativeSnapshot) {
      const component = components.find((item) => deriveComponentId(item.name, item.source) === snapshot.component_id);
      if (!component || !componentDecisionInventory(component).properties.includes(snapshot.prop_name)) continue;
      const previous = JSON.parse(snapshot.decision_json) as Record<string, unknown>;
      const definition = JSON.parse(snapshot.definition_json) as CDFPropertyDefinition | null;
      const intent = previous.defaultIntent as ClassifiedPropertyCall['default_intent'];
      let retained = previous;
      let active: CDFPropertyDefinition | null = null;
      let call: ToolCall | undefined;
      try {
        if (definition) {
          const sourceDecision = previous.call as ClassifiedPropertyCall | undefined;
          call = definitionCall(snapshot.prop_name, definition, intent, undefined, sourceDecision);
          const current = materializeProperty(component, call, snapshot.component_id, {
            defaultAuthority: previous.kind === 'review' ? 'review' : 'generation',
          });
          if (
            !current.definition ||
            (current.projection && !['supported', 'lossy'].includes(current.projection.outcome))
          )
            throw new Error('Transferred representation requires review');
          active = current.definition;
          retained = {
            ...previous,
            ...current,
            transfer: { state: 'compatible' },
            ...(previous.kind === 'review' ? { reviewAuthority: current.model?.identity ?? null } : {}),
          };
        } else {
          const ledger = ledgerSnapshot.find((item) => item.component_id === snapshot.component_id);
          const priorCalls = ledger ? (JSON.parse(ledger.payload_json) as { calls: ToolCall[] }).calls : [];
          call = priorCalls.find(
            (item) =>
              (item.tool === 'exclude_prop' || item.tool === 'classify_prop') && item.prop === snapshot.prop_name,
          );
          if (call?.tool === 'classify_prop')
            retained = {
              ...previous,
              ...materializeProperty(component, call, snapshot.component_id),
              transfer: { state: 'compatible' },
            };
          else if (call?.tool === 'exclude_prop')
            retained = { ...previous, source: component.sourceCandidates ?? null, transfer: { state: 'compatible' } };
          else throw new Error('Transferred disposition unavailable');
        }
      } catch (error) {
        retained = {
          ...previous,
          transfer: { state: 'stale', reason: error instanceof Error ? error.message : 'Source changed' },
        };
        call = undefined;
      }
      db.prepare(
        'INSERT INTO raw_property_decisions(session_id,component_id,prop_name,revision,definition_json,decision_json) VALUES (?,?,?,?,?,?)',
      ).run(
        sessionId,
        snapshot.component_id,
        snapshot.prop_name,
        snapshot.revision,
        JSON.stringify(active ?? definition),
        JSON.stringify(retained),
      );
      if (active)
        db.prepare(
          'UPDATE raw_props SET cdf_type=?,cdf_category=?,cdf_token_kind=?,required=?,description=? WHERE session_id=? AND component_id=? AND name=?',
        ).run(
          active.$type,
          active.$category,
          active['$token.kind'] ?? null,
          active.$required ? 1 : 0,
          active.$description ?? null,
          sessionId,
          snapshot.component_id,
          snapshot.prop_name,
        );
      if (call) transferred.set(snapshot.component_id, [...(transferred.get(snapshot.component_id) ?? []), call]);
      if (active?.$type === 'token')
        for (const token of tokenSnapshot.filter(
          (item) => item.component_id === snapshot.component_id && item.prop_name === snapshot.prop_name,
        ))
          db.prepare(
            'INSERT INTO raw_prop_token_paths(session_id,component_id,prop_name,source,position,path) VALUES (?,?,?,?,?,?)',
          ).run(sessionId, token.component_id, token.prop_name, token.source, token.position, token.path);
    }
    for (const snapshot of ledgerSnapshot) {
      const component = components.find((item) => deriveComponentId(item.name, item.source) === snapshot.component_id);
      if (!component) continue;
      const previous = JSON.parse(snapshot.payload_json) as { calls: ToolCall[] };
      let slots: SlotDecision[] | undefined;
      let slotSourceCurrent = true;
      try {
        slots = loadAcceptedSlotDecisions(db, sessionId);
      } catch {
        slotSourceCurrent = false;
      }
      const inventory = componentDecisionInventory(component, slots);
      const calls = [
        ...previous.calls.filter(
          (call) =>
            call.tool === 'classify_component' ||
            (call.tool === 'classify_slot' && inventory.slots.some((slot) => slot.name === call.slot)),
        ),
        ...(transferred.get(snapshot.component_id) ?? []),
      ];
      const normalized = normalizeClassificationCalls(calls);
      const accounting = accountClassificationCalls(inventory, normalized.calls);
      if (!slotSourceCurrent) accounting.complete = false;
      db.prepare('INSERT INTO raw_component_decisions(session_id,component_id,payload_json) VALUES (?,?,?)').run(
        sessionId,
        snapshot.component_id,
        JSON.stringify({
          schemaVersion: 1,
          calls: normalized.calls,
          inventory,
          source: component.sourceCandidates ?? null,
          accountingComplete: accounting.complete,
          transfer: { state: accounting.complete ? 'compatible' : 'needs-review' },
        }),
      );
      const importComplete =
        accounting.complete &&
        normalized.calls
          .filter((call) => call.tool === 'classify_prop')
          .every(
            (call) =>
              !!db
                .prepare('SELECT cdf_type FROM raw_props WHERE session_id=? AND component_id=? AND name=?')
                .get(sessionId, snapshot.component_id, call.prop)?.['cdf_type'],
          );
      db.prepare('UPDATE raw_components SET status=? WHERE session_id=? AND component_id=?').run(
        importComplete ? 'generated' : 'held',
        sessionId,
        snapshot.component_id,
      );
    }
    for (const snapshot of descriptionSnapshot)
      db.prepare('UPDATE raw_components SET description=? WHERE session_id=? AND component_id=?').run(
        snapshot.description,
        sessionId,
        snapshot.component_id,
      );

    if (options?.preserveStatus && statusSnapshot.length > 0) {
      const restoreStatus = db.prepare(
        `UPDATE raw_components SET status = ?, reject_reason = ?
         WHERE session_id = ? AND component_id = ?`,
      );
      for (const snapshot of statusSnapshot) {
        const current = db
          .prepare('SELECT status FROM raw_components WHERE session_id=? AND component_id=?')
          .get(sessionId, snapshot.component_id) as { status: string } | undefined;
        const status =
          options?.preserveCDF && snapshot.status === 'generated' && current?.status === 'held'
            ? 'held'
            : snapshot.status;
        restoreStatus.run(status, snapshot.reject_reason, sessionId, snapshot.component_id);
      }
    }

    if (options?.status) {
      db.prepare('UPDATE raw_components SET status = ? WHERE session_id = ?').run(options.status, sessionId);
    }
    if (options?.preserveCDF) assertPreservedRepresentationSelections(db, sessionId);
    if (options?.extractionDiagnostics !== undefined) {
      db.prepare(
        `INSERT INTO extraction_source_diagnostics (session_id, payload_json) VALUES (?, ?)
         ON CONFLICT(session_id) DO UPDATE SET payload_json = excluded.payload_json`,
      ).run(sessionId, JSON.stringify(options.extractionDiagnostics));
    }
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    if (ownsTransaction) db.exec('COMMIT');
  } catch (e) {
    if (ownsTransaction) db.exec('ROLLBACK');
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
      'SELECT component_id, name, source, framework, review_reasons, needs_review, source_path FROM raw_components WHERE session_id = ? ORDER BY rowid',
    )
    .all(sessionId) as Array<{
    component_id: string;
    name: string;
    source: string;
    framework: string;
    review_reasons: string;
    needs_review: number;
    source_path: string | null;
  }>;

  const components = allowedNames ? all.filter((c) => allowedNames.has(c.name)) : all;

  if (components.length === 0) return [];

  const props = db
    .prepare(
      `SELECT component_id, name, type, required, category, default_value, description, token_reference, position,
              rationale, source_start_line, source_end_line, dom_attribute
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
    dom_attribute: number | null;
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

  const sourceEvidenceRows = db
    .prepare(
      `SELECT component_id, fact_schema_version, candidates_json, alternate_sources_json, component_facts_json
       FROM raw_component_source_evidence WHERE session_id = ?`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    fact_schema_version: number | null;
    candidates_json: string | null;
    alternate_sources_json: string | null;
    component_facts_json: string | null;
  }>;
  const componentFactsByComponent = new Map<string, ComponentFactsRead>(
    sourceEvidenceRows.map((row) => [row.component_id, readComponentFactsJson(row.component_facts_json)]),
  );
  if (
    [...componentFactsByComponent.values()].some((read) => read.facts?.sourceClosure || read.facts?.sourceObservations)
  ) {
    const source = loadCompletedSourceEvidence(db, sessionId);
    for (const [id, read] of componentFactsByComponent) {
      if (read.facts && (read.facts.sourceClosure || read.facts.sourceObservations)) {
        const sourceClosure = read.facts.sourceClosure
          ? validateSavedSourceClosure(read.facts.sourceClosure, source)
          : undefined;
        const observations = read.facts.sourceObservations
          ? mapSourceObservationLocations(
              read.facts.sourceObservations,
              createCapturedLocationBinder(source.readiness === 'ready' ? source.envelope.capture.files : []),
            )
          : undefined;
        componentFactsByComponent.set(id, {
          ...read,
          facts: {
            ...read.facts,
            ...(sourceClosure ? { sourceClosure } : {}),
            ...(observations
              ? {
                  sourceObservations: {
                    ...observations,
                    ...(observations.fieldSemantics
                      ? {
                          fieldSemantics: validateSavedFieldReplay(
                            observations.fieldSemantics,
                            source.readiness === 'ready' ? source.envelope.capture.files : [],
                          ),
                        }
                      : {}),
                    ...(observations.inputOutput
                      ? {
                          inputOutput: validateSavedInputOutput(
                            observations.inputOutput,
                            source,
                            hasBoundComponentDeclaration(observations),
                          ),
                        }
                      : {}),
                    ...(observations.referenceIndex
                      ? {
                          referenceIndex: bindSavedSourceReferences(
                            observations.referenceIndex,
                            source.readiness === 'ready' ? source.envelope.capture.files : [],
                          ),
                        }
                      : {}),
                  },
                }
              : {}),
          },
        });
      }
    }
  }
  const completedCandidates = loadCompletedSourceEvidence(db, sessionId);
  const sourceEvidenceByComponent = new Map<
    string,
    {
      status: NonNullable<RawComponentDefinition['sourceEvidenceReadStatus']>;
      factSchemaVersion?: number;
      candidates?: SourceCandidate[];
      alternates?: SourceCandidateSource[];
    }
  >();
  for (const row of sourceEvidenceRows) {
    if (row.fact_schema_version === null && row.candidates_json === null && row.alternate_sources_json === null) {
      sourceEvidenceByComponent.set(row.component_id, { status: 'unknown-legacy' });
      continue;
    }
    if (
      row.fact_schema_version === null ||
      !SUPPORTED_SOURCE_FACT_SCHEMA_VERSIONS.includes(row.fact_schema_version as 3 | 4)
    ) {
      sourceEvidenceByComponent.set(row.component_id, { status: 'unsupported' });
      continue;
    }
    try {
      if (row.candidates_json === null) throw new Error('candidate-payload-missing');
      const candidates = JSON.parse(row.candidates_json) as unknown;
      const alternates = row.alternate_sources_json === null ? [] : (JSON.parse(row.alternate_sources_json) as unknown);
      if (!isSourceCandidatePayload(candidates) || !isAlternateSourcePayload(alternates))
        throw new Error('candidate-payload-invalid');
      const candidateComponent: RawComponentDefinition = {
        name: '',
        source: '',
        framework: 'react',
        props: [],
        slots: [],
        factSchemaVersion: row.fact_schema_version,
        sourceCandidates: candidates,
        sourceCandidateSources: alternates,
      };
      const expectedDigest =
        completedCandidates.readiness === 'ready'
          ? completedCandidates.envelope.candidateDigests?.[row.component_id]
          : undefined;
      if (expectedDigest && expectedDigest !== candidateEvidenceDigest(candidateComponent))
        throw new Error('candidate-source-digest-mismatch');
      const rebound = bindSourceCandidatesToCapture(
        [candidateComponent],
        completedCandidates.readiness === 'ready' ? completedCandidates.envelope.capture.files : [],
      )[0]!;
      sourceEvidenceByComponent.set(row.component_id, {
        status: 'available',
        factSchemaVersion: row.fact_schema_version,
        candidates: rebound.sourceCandidates,
        alternates: rebound.sourceCandidateSources,
      });
    } catch {
      sourceEvidenceByComponent.set(row.component_id, { status: 'corrupt' });
    }
  }

  const propsByComponent = indexRowsByKey(props, (p) => p.component_id);
  const allowedValuesByProp = indexRowsByKey(allowedValues, (av) => `${av.component_id}::${av.prop_name}`);
  const slotsByComponent = indexRowsByKey(slots, (s) => s.component_id);
  const allowedComponentsBySlot = indexRowsByKey(allowedComponents, (ac) => `${ac.component_id}::${ac.slot_name}`);

  return components.map(
    (c): RawComponentWithId => ({
      component_id: c.component_id,
      name: c.name,
      source: c.source,
      framework: c.framework as RawComponentDefinition['framework'],
      reviewReasons: parseReviewReasons(c.review_reasons),
      needsReview: Boolean(c.needs_review),
      sourcePath: c.source_path ?? undefined,
      componentEvidenceReadStatus: componentFactsByComponent.get(c.component_id)?.status ?? 'unknown-legacy',
      ...(componentFactsByComponent.get(c.component_id)?.status === 'available'
        ? { componentFacts: componentFactsByComponent.get(c.component_id)!.facts! }
        : {}),
      sourceEvidenceReadStatus: sourceEvidenceByComponent.get(c.component_id)?.status ?? 'unknown-legacy',
      ...(sourceEvidenceByComponent.get(c.component_id)?.factSchemaVersion !== undefined
        ? { factSchemaVersion: sourceEvidenceByComponent.get(c.component_id)!.factSchemaVersion! }
        : {}),
      ...(sourceEvidenceByComponent.get(c.component_id)?.status === 'available'
        ? {
            sourceCandidates: sourceEvidenceByComponent.get(c.component_id)!.candidates!,
            sourceCandidateSources: sourceEvidenceByComponent.get(c.component_id)!.alternates!,
          }
        : {}),
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
        if (p.dom_attribute !== null) prop.domAttribute = Boolean(p.dom_attribute);
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

export type ExtractionSourceDiagnosticsRead =
  | { status: 'available'; diagnostics: ExtractionDiagnostics }
  | { status: 'absent' | 'corrupt' | 'unsupported' };

export function loadExtractionSourceDiagnostics(db: DatabaseSync, sessionId: string): ExtractionSourceDiagnosticsRead {
  const row = db
    .prepare('SELECT payload_json FROM extraction_source_diagnostics WHERE session_id = ?')
    .get(sessionId) as { payload_json: string } | undefined;
  if (!row) return { status: 'absent' };
  try {
    const diagnostics = JSON.parse(row.payload_json) as unknown;
    if (
      diagnostics !== null &&
      typeof diagnostics === 'object' &&
      'schemaVersion' in diagnostics &&
      diagnostics.schemaVersion !== 1
    ) {
      return { status: 'unsupported' };
    }
    if (!isExtractionDiagnosticsPayload(diagnostics)) return { status: 'corrupt' };
    return { status: 'available', diagnostics };
  } catch {
    return { status: 'corrupt' };
  }
}

// A token-resolution map sometimes lives behind a component that itself
// re-exports another component's prop (A imports B, B imports B's own
// styles module) rather than beside the component being classified. Two hops
// covers "the component's own imports" plus "those imports' own imports"
// without walking the whole dependency graph.
const MAX_SIBLING_DEPTH = 2;
// Caps total files read during discovery when a hop-1 import is a barrel with many
// re-exports, each of which would otherwise be walked for a second hop.
const MAX_SIBLING_CANDIDATES_EXPLORED = 25;
const RELATIVE_IMPORT_PATTERN = /from\s+['"](\.[^'"]+)['"]/g;
const SIBLING_FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
// TS node16/nodenext/bundler resolution requires the *emitted* extension in
// the specifier (`./Badge.types.js` for a file named `Badge.types.ts`).
const TS_ESM_EXTENSION_REWRITES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['.js', ['.ts', '.tsx', '.js', '.jsx']],
  ['.jsx', ['.tsx', '.jsx']],
  ['.mjs', ['.mts', '.mjs']],
  ['.cjs', ['.cts', '.cjs']],
];

// Candidate source paths for a specifier with an emitted extension, else [].
function rewrittenSourcePaths(basePath: string): string[] {
  for (const [emitted, sources] of TS_ESM_EXTENSION_REWRITES) {
    if (!basePath.endsWith(emitted)) continue;
    const stem = basePath.slice(0, -emitted.length);
    return sources.map((ext) => `${stem}${ext}`);
  }
  return [];
}

const IDENTIFIER_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

function identifiersIn(propTypes: string[]): string[] {
  const names = new Set<string>();
  for (const propType of propTypes) for (const match of propType.matchAll(IDENTIFIER_PATTERN)) names.add(match[0]);
  return [...names];
}

function extractRelativeImportPaths(sourceText: string): string[] {
  const specifiers = new Set<string>();
  for (const match of sourceText.matchAll(RELATIVE_IMPORT_PATTERN)) {
    if (match[1]) specifiers.add(match[1]);
  }
  return [...specifiers];
}

// Tries the specifier as a file directly, then with each known extension,
// then as a directory's index file — same resolution order as Node's own
// extension-less relative import resolution.
async function resolveRelativeImport(specifier: string, fromDir: string): Promise<string | undefined> {
  const basePath = resolve(fromDir, specifier);
  const candidates = [
    basePath,
    ...rewrittenSourcePaths(basePath),
    ...SIBLING_FILE_EXTENSIONS.map((ext) => `${basePath}${ext}`),
    ...SIBLING_FILE_EXTENSIONS.map((ext) => resolve(basePath, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      // Not this candidate — try the next.
    }
  }
  return undefined;
}

// Resolves every relative specifier a file imports, in source order. Bare
// package specifiers (`react`, `@scope/pkg`) are deliberately not followed:
// on a monorepo they resolve to built `dist/` bundles, which fill sibling
// slots with minified output rather than the source line a classifier can
// cite.
async function resolveImportSpecifiers(sourceText: string, fromDir: string): Promise<string[]> {
  const resolvedPaths: string[] = [];
  for (const specifier of extractRelativeImportPaths(sourceText)) {
    const resolvedPath = await resolveRelativeImport(specifier, fromDir);
    if (resolvedPath) resolvedPaths.push(resolvedPath);
  }
  return resolvedPaths;
}

// Discover relative imports within the traversal bounds, then inline each file in full.
async function loadSiblingFiles(
  sourceText: string,
  sourcePath: string,
): Promise<Array<{ path: string; content: string }>> {
  const visited = new Set<string>([resolve(sourcePath)]);
  const discovered: Array<{ path: string; content: string }> = [];

  let frontier: Array<{ text: string; dir: string }> = [{ text: sourceText, dir: dirname(sourcePath) }];

  for (let hop = 0; hop < MAX_SIBLING_DEPTH && discovered.length < MAX_SIBLING_CANDIDATES_EXPLORED; hop++) {
    const nextFrontier: Array<{ text: string; dir: string }> = [];

    for (const node of frontier) {
      if (discovered.length >= MAX_SIBLING_CANDIDATES_EXPLORED) break;

      const resolvedPaths = await resolveImportSpecifiers(node.text, node.dir);
      for (const resolvedPath of resolvedPaths) {
        if (visited.has(resolvedPath)) continue;
        visited.add(resolvedPath);
        if (discovered.length >= MAX_SIBLING_CANDIDATES_EXPLORED) break;

        let content: string;
        try {
          content = await readFile(resolvedPath, 'utf8');
        } catch {
          // Resolved but became unreadable between the resolve check and this read — skip it.
          continue;
        }
        discovered.push({ path: resolvedPath, content });
        nextFrontier.push({ text: content, dir: dirname(resolvedPath) });
      }
    }

    frontier = nextFrontier;
  }

  return discovered;
}

// Reads and inlines real file content here, at the last point this pipeline
// has local filesystem access — the map-tokens/generate-components agent
// invocations are deliberately filesystem-free (stdout-only tool-call
// protocol), so a bare path is useless to them. Read failures (file moved or
// deleted since extraction) resolve to `content: null`, not a thrown error —
// callers fall back to inferring from the prop name and $token.kind alone.
export async function loadComponentSourceRef(
  name: string,
  sourcePath: string,
  _propNames: string[] = [],
  _propTypes: string[] = [],
): Promise<ComponentSourceRef> {
  let content: string | null = null;
  let siblingFiles: Array<{ path: string; content: string }> = [];
  try {
    content = await readFile(sourcePath, 'utf8');
    siblingFiles = await loadSiblingFiles(content, sourcePath);
  } catch {
    // File no longer exists or unreadable — leave content null.
  }
  return { component: name, sourcePath, content, ...(siblingFiles.length ? { siblingFiles } : {}) };
}

export async function loadComponentSourceRefs(db: DatabaseSync, sessionId: string): Promise<ComponentSourceRef[]> {
  const rows = db
    .prepare(
      `SELECT component_id, name, source, source_path FROM raw_components WHERE session_id = ? AND status = 'generated' ORDER BY rowid`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    name: string;
    source: string;
    source_path: string | null;
  }>;
  const propsFor = db.prepare(
    `SELECT name, type FROM raw_props WHERE session_id = ? AND component_id = ? ORDER BY position`,
  );

  return Promise.all(
    rows.map((r) => {
      const props = propsFor.all(sessionId, r.component_id) as Array<{
        name: string;
        type: string;
      }>;
      return loadSavedComponentSourceRef(
        db,
        sessionId,
        r.component_id,
        r.name,
        r.source_path ?? r.source,
        props.map((p) => p.name),
        props.map((p) => p.type),
      );
    }),
  );
}

export type CompletedSharedSourceEvidence =
  | { readiness: 'ready'; handle: SourceEvidenceHandle; source: SharedSource }
  | { readiness: 'unavailable'; reason: string };

export function loadSavedSharedSource(
  db: DatabaseSync,
  sessionId: string,
  options: { componentIds?: readonly string[]; handle?: SourceEvidenceHandle } = {},
): CompletedSharedSourceEvidence {
  const saved = loadCompletedSourceEvidence(db, sessionId, options.handle);
  if (saved.readiness !== 'ready') return saved;
  return {
    readiness: 'ready',
    handle: saved.handle,
    source: projectSharedSource(buildSharedSource(saved.envelope, options.componentIds)),
  };
}

export function loadSavedComponentSourceRef(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  name: string,
  sourcePath: string,
  propNames: string[] = [],
  propTypes: string[] = [],
): ComponentSourceRef {
  // Preserve the callable compatibility adapter; saved projections never consult disk.
  const saved = loadCompletedSourceEvidence(db, sessionId);
  const unavailable: ComponentSourceRef = { component: name, sourcePath, content: null };
  if (saved.readiness !== 'ready') return unavailable;
  const root = findSourceOwnerFile(saved.envelope.capture, componentId, sourcePath);
  if (!root) return unavailable;
  const source = buildSharedSource(saved.envelope, [componentId]);
  if (!source.files.some((file) => file.fileId === root.fileId)) source.files.unshift(projectCapturedFile(root));
  // Keep the definition first while preserving all saved source files.
  source.files.sort((a, b) => Number(b.fileId === root.fileId) - Number(a.fileId === root.fileId));
  const projected = projectSharedSource(source);
  const main = projected.files.find((file) => file.fileId === root.fileId);
  if (!main || main.coverage === 'unavailable') return unavailable;
  const metadata = (file: SharedSource['files'][number]) => ({
    captureId: saved.envelope.capture.captureId,
    captureDigest: saved.envelope.digest,
    textHash: file.textHash ?? null,
    coverage: projected.promptCoverage ?? 'partial',
    extractionByteBinding: saved.envelope.extractionByteBinding,
    lineRanges: (file.ranges ?? []).map(({ startLine, endLine }) => ({ startLine, endLine })),
    ...(file.compilerContextId ? { compilerContextId: file.compilerContextId } : {}),
  });
  const siblings = projected.files.filter((file) => file.fileId !== root.fileId && file.coverage !== 'unavailable');
  const partial = main.partial || (projected.omittedFiles ?? 0) > 0 || siblings.some((file) => file.partial);
  return {
    component: name,
    sourcePath: main.path,
    content: main.content,
    sourceEvidence: metadata(main),
    ...(projected.compilerContexts ? { compilerContexts: projected.compilerContexts } : {}),
    ...(siblings.length
      ? {
          siblingFiles: siblings.map((file) => ({
            path: file.path,
            content: file.content,
            sourceEvidence: metadata(file),
          })),
        }
      : {}),
    ...(projected.omittedFiles ? { truncatedSiblingCount: projected.omittedFiles } : {}),
    ...(partial ? { usesNotShown: [...new Set([...propNames, ...identifiersIn(propTypes)])] } : {}),
  };
}

export function renameEmptySlots(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  componentName: string,
  slotCount: number,
): {
  renames: Array<{ oldName: string; newName: string }>;
  warnings: string[];
} {
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

  db.exec('BEGIN');
  try {
    for (const slot of emptySlots) {
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

function parseReviewReasons(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((reason): reason is string => typeof reason === 'string') : [];
  } catch {
    // A malformed historical value should not prevent callers from loading.
    return [];
  }
}

export function storeCDFComponents(
  db: DatabaseSync,
  sessionId: string,
  components: Array<{ key: string; componentId?: string; entry: CDFComponentEntry }>,
): void {
  const keys = components.map((component) => component.componentId ?? component.key);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate review component identity');
  const sources = loadRawComponents(db, sessionId);
  const priorDecisions = loadPropertyDecisions(db, sessionId);
  const effectiveBaselines = loadCDFComponents(db, sessionId);
  const prepared = new Map<string, ReturnType<typeof materializeProperty>>();
  components = components.map((component) => {
    const matches = sources.filter((source) =>
      component.componentId
        ? source.component_id === component.componentId && source.name === component.key
        : source.name === component.key,
    );
    if (matches.length !== 1) throw new Error('Unknown or ambiguous review component identity');
    return {
      ...component,
      entry: prepareEntryRepresentationPlans(db, sessionId, matches[0]!.component_id, component.entry),
    };
  });
  for (const { key, componentId, entry } of components) {
    const matches = sources.filter((component) =>
      componentId ? component.component_id === componentId && component.name === key : component.name === key,
    );
    if (matches.length !== 1) throw new Error('Unknown or ambiguous review component identity');
    const source = matches[0]!;
    const inventory = componentDecisionInventory(source, loadAcceptedSlotDecisions(db, sessionId));
    for (const name of Object.keys(entry.$properties))
      if (!inventory.properties.includes(name)) throw new Error('Review property has no exact retained source owner');
    for (const name of inventory.properties) {
      const previous = priorDecisions.find(
        (decision) => decision.componentId === source.component_id && decision.propertyName === name,
      );
      if (!own(entry.$properties, name) && !own(entry.$representationPlans ?? {}, name) && previous?.definition)
        throw new Error('Imported source property removed without an accounting decision');
    }
    const completeValidation = CDFComponentSchema.safeParse(entry);
    if (!completeValidation.success)
      throw new Error(
        `Invalid complete CDF entry: ${completeValidation.error.issues.map((issue) => `${issue.path.join('.') || 'component'}: ${issue.message}`).join('; ')}`,
      );
    if (source) validateCDFSourceOwners(source, entry);
    else if (
      Object.values(entry.$slots ?? {}).some((slot) => slot.$sourceInput) ||
      Object.values(entry.$properties).some((property) => property.$sourceInput)
    )
      throw new Error('CDF source input component unavailable');
    const unsafe = jsonValueIssue(entry);
    if (unsafe) throw new Error(`${unsafe.path}: ${unsafe.message}`);
    for (const [name, property] of Object.entries(entry.$properties)) {
      if (property.$type === 'token' && property['$token.allowed']) {
        const paths = property['$token.allowed'];
        if (new Set(paths).size !== paths.length) throw new Error('Duplicate reviewed token mapping');
        for (const path of paths) {
          const token = db.prepare('SELECT type FROM raw_tokens WHERE session_id=? AND path=?').get(sessionId, path) as
            | { type: string }
            | undefined;
          if (token && token.type !== property['$token.kind']) throw new Error('Reviewed token mapping kind changed');
        }
      }
      const validation = validateCDFProperty(property);
      if (!validation.valid) throw new Error(validation.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
      if (
        property.$values &&
        !source.sourceCandidates?.find((candidate) => candidate.name === name)?.facts?.sourceGraph
      )
        throw new Error('Finite constraints require current complete compiler source evidence');
      if (source.sourceCandidates?.find((candidate) => candidate.name === name)?.facts?.sourceGraph) {
        const previous = priorDecisions.find(
          (decision) => decision.componentId === source.component_id && decision.propertyName === name,
        );
        const priorIntent = (
          previous?.decision as { defaultIntent?: ClassifiedPropertyCall['default_intent'] } | undefined
        )?.defaultIntent;
        const baseline =
          effectiveBaselines.find((entry) => entry.componentId === source.component_id)?.entry.$properties[name] ??
          previous?.definition;
        const unchangedDefault =
          baseline &&
          baseline.$type === property.$type &&
          own(baseline, '$default') === own(property, '$default') &&
          jsonEqual(baseline.$default, property.$default);
        const materialized = materializeProperty(
          source,
          definitionCall(
            name,
            property,
            unchangedDefault && priorIntent
              ? priorIntent
              : own(property, '$default')
                ? { action: 'set', value: property.$default! }
                : { action: 'clear' },
            reviewRepresentationProposal(
              property,
              (previous?.decision as { call?: { representation_proposal?: RepresentationProposalDraft } } | undefined)
                ?.call?.representation_proposal,
            ),
            (previous?.decision as { call?: ClassifiedPropertyCall } | undefined)?.call,
          ),
          source.component_id,
          { defaultAuthority: 'review' },
        );
        prepared.set(JSON.stringify([source.component_id, name]), materialized);
        if (
          !entry.$representationPlans?.[name] &&
          materialized.projection &&
          !['supported', 'lossy'].includes(materialized.projection.outcome)
        )
          throw new Error('Native position unavailable; source and saved decisions retained');
        if (
          materialized.projection?.issues.some(
            (issue) => issue.message === 'Source mapper and mapped target must both support default',
          )
        )
          throw new Error('Default unavailable for this mapper; source and saved decisions retained');
      }
    }
  }
  const now = new Date().toISOString();

  const updateComp = db.prepare(
    `UPDATE raw_components SET status = 'generated', description = ? WHERE session_id = ? AND component_id = ?`,
  );
  const updateProp = db.prepare(
    `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?, required = ? WHERE session_id = ? AND component_id = ? AND name = ?`,
  );
  const insertAllowedComponent = db.prepare(
    `INSERT INTO raw_slot_allowed_components (session_id, component_id, slot_name, allowed_component, position)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const deleteTokenPaths = db.prepare(
    `DELETE FROM raw_prop_token_paths WHERE session_id = ? AND component_id = ? AND prop_name = ?`,
  );
  const insertTokenPath = db.prepare(
    `INSERT INTO raw_prop_token_paths (session_id, component_id, prop_name, source, position, path)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  // storeCDFComponents is only reached from the review editor, so a list written
  // here is a person's decision and is recorded as such.
  const writeTokenPaths = (componentId: string, propName: string, paths: string[]) => {
    const previous = db
      .prepare(
        'SELECT path FROM raw_prop_token_paths WHERE session_id=? AND component_id=? AND prop_name=? ORDER BY position',
      )
      .all(sessionId, componentId, propName) as Array<{ path: string }>;
    if (
      jsonEqual(
        previous.map((entry) => entry.path),
        paths,
      )
    )
      return;
    deleteTokenPaths.run(sessionId, componentId, propName);
    paths.forEach((path, position) => insertTokenPath.run(sessionId, componentId, propName, 'review', position, path));
  };
  const deleteSlots = db.prepare(`DELETE FROM raw_slots WHERE session_id = ? AND component_id = ?`);
  const deleteSlotAllowedComponents = db.prepare(
    `DELETE FROM raw_slot_allowed_components WHERE session_id = ? AND component_id = ?`,
  );
  const readExistingSlotDefaults = db.prepare(
    `SELECT name, is_default FROM raw_slots WHERE session_id = ? AND component_id = ?`,
  );
  const insertSlotOnUpdate = db.prepare(
    `INSERT INTO raw_slots (session_id, component_id, name, is_default, required, description, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    for (const { key, componentId: requestedId, entry } of components) {
      const matched = sources.find((component) =>
        requestedId ? component.component_id === requestedId : component.name === key,
      )!;
      const row = { component_id: matched.component_id };

      if (row) {
        const { component_id: componentId } = row;
        updateComp.run(entry.$description ?? null, sessionId, componentId);
        const names = new Set(Object.keys(entry.$properties));
        const existingProps = db
          .prepare('SELECT name FROM raw_props WHERE session_id=? AND component_id=?')
          .all(sessionId, componentId) as Array<{ name: string }>;
        for (const existing of existingProps)
          if (!names.has(existing.name))
            db.prepare(
              'UPDATE raw_props SET cdf_type=NULL,cdf_category=NULL,cdf_token_kind=NULL WHERE session_id=? AND component_id=? AND name=?',
            ).run(sessionId, componentId, existing.name);
        for (const [propName, prop] of Object.entries(entry.$properties)) {
          const updated = updateProp.run(
            prop.$type,
            prop.$category,
            prop['$token.kind'] ?? null,
            prop.$required ? 1 : 0,
            sessionId,
            componentId,
            propName,
          );
          if (!Number(updated.changes))
            db.prepare(
              `INSERT INTO raw_props (session_id,component_id,name,type,required,category,default_value,description,token_reference,position,cdf_type,cdf_category,cdf_token_kind)
            VALUES (?,?,?,'',?,NULL,NULL,?,NULL,(SELECT COALESCE(MAX(position),-1)+1 FROM raw_props WHERE session_id=? AND component_id=?),?,?,?)`,
            ).run(
              sessionId,
              componentId,
              propName,
              prop.$required ? 1 : 0,
              prop.$description ?? null,
              sessionId,
              componentId,
              prop.$type,
              prop.$category,
              prop['$token.kind'] ?? null,
            );
          const baseline = effectiveBaselines.find((entry) => entry.componentId === componentId)?.entry.$properties[
            propName
          ];
          const prior = priorDecisions.find(
            (decision) => decision.componentId === componentId && decision.propertyName === propName,
          );
          if (!prior || !jsonEqual(baseline, prop))
            savePropertyDecision(db, sessionId, componentId, propName, prop, {
              kind: 'review',
              producer: { kind: 'review', id: randomUUID(), sessionId, componentId },
              ...(prepared.get(JSON.stringify([componentId, propName])) ?? {}),
              reviewAuthority: prepared.get(JSON.stringify([componentId, propName]))?.model?.identity ?? null,
              defaultIntent:
                prepared.get(JSON.stringify([componentId, propName]))?.model?.defaultIntent ??
                (own(prop, '$default') ? { action: 'set', value: prop.$default } : { action: 'clear' }),
            });
          db.prepare('UPDATE raw_props SET description=? WHERE session_id=? AND component_id=? AND name=?').run(
            prop.$description ?? null,
            sessionId,
            componentId,
            propName,
          );
          if (prop.$type === 'token' && prop.$category === 'design') {
            // Reconcile the persisted mapping even when the property omits
            // the field: omission is the dismiss/unrestricted state.
            writeTokenPaths(componentId, propName, prop['$token.allowed'] ?? []);
          }
        }

        const sourceEntry = cloneJson(entry);
        for (const plan of Object.values(entry.$representationPlans ?? {}))
          if (plan.attachment) delete sourceEntry.$slots?.[plan.attachment.slot];
        if (loadAcceptedSlotDecisions(db, sessionId) !== undefined) {
          saveReviewedSlots(db, sessionId, componentId, sourceEntry);
        } else {
          const existingDefaults = new Map<string, number>(
            (
              readExistingSlotDefaults.all(sessionId, componentId) as Array<{
                name: string;
                is_default: number;
              }>
            ).map((r) => [r.name, r.is_default]),
          );
          deleteSlotAllowedComponents.run(sessionId, componentId);
          deleteSlots.run(sessionId, componentId);
          let slotPos = 0;
          for (const [slotName, slot] of Object.entries(sourceEntry.$slots ?? {})) {
            const isDefault = existingDefaults.get(slotName) ?? 0;
            insertSlotOnUpdate.run(
              sessionId,
              componentId,
              slotName,
              isDefault,
              slot.$required ? 1 : 0,
              slot.$description ?? null,
              slotPos++,
            );
            if (slot.$allowedComponents && slot.$allowedComponents.length > 0) {
              slot.$allowedComponents.forEach((ac, i) =>
                insertAllowedComponent.run(sessionId, componentId, slotName, ac, i),
              );
            }
          }
        }
        saveEntryRepresentationPlans(db, sessionId, componentId, entry);
        const currentSource = sources.find((source) => source.component_id === componentId)!;
        const currentInventory = componentDecisionInventory(currentSource, loadAcceptedSlotDecisions(db, sessionId));
        const ledgerRow = db
          .prepare('SELECT payload_json FROM raw_component_decisions WHERE session_id=? AND component_id=?')
          .get(sessionId, componentId) as { payload_json: string } | undefined;
        const priorCalls = ledgerRow ? (JSON.parse(ledgerRow.payload_json) as { calls: ToolCall[] }).calls : [];
        const decisions = loadPropertyDecisions(db, sessionId).filter(
          (decision) => decision.componentId === componentId,
        );
        const currentCalls: ToolCall[] = [
          {
            tool: 'classify_component',
            ...(entry.$description === undefined ? {} : { description: entry.$description }),
          },
        ];
        for (const name of currentInventory.properties) {
          const saved = decisions.find((decision) => decision.propertyName === name);
          const definition = entry.$properties[name];
          if (definition)
            currentCalls.push(
              definitionCall(
                name,
                definition,
                (saved?.decision as { defaultIntent?: ClassifiedPropertyCall['default_intent'] } | undefined)
                  ?.defaultIntent,
                (saved?.decision as { call?: ClassifiedPropertyCall } | undefined)?.call?.representation_proposal,
                (saved?.decision as { call?: ClassifiedPropertyCall } | undefined)?.call,
              ),
            );
          else {
            const retained = priorCalls.find(
              (call) => (call.tool === 'classify_prop' || call.tool === 'exclude_prop') && call.prop === name,
            );
            if (
              retained &&
              (own(entry.$representationPlans ?? {}, name) ||
                retained.tool === 'exclude_prop' ||
                (retained.tool === 'classify_prop' && !retained.cdf_type))
            )
              currentCalls.push(retained);
          }
        }
        for (const slot of currentInventory.slots) {
          const definition = entry.$slots?.[slot.name];
          if (definition)
            currentCalls.push({
              tool: 'classify_slot',
              slot: slot.name,
              ...(definition.$required === undefined ? {} : { required: definition.$required }),
              ...(definition.$description === undefined ? {} : { description: definition.$description }),
              ...(definition.$allowedComponents ? { allowed_components: definition.$allowedComponents } : {}),
            });
        }
        const normalized = normalizeClassificationCalls(currentCalls);
        const accounting = accountClassificationCalls(currentInventory, normalized.calls);
        if (normalized.warnings.length || !accounting.complete)
          throw new Error([...normalized.warnings, ...accounting.issues, ...accounting.missing].join('; '));
        db.prepare(
          'INSERT INTO raw_component_decisions(session_id,component_id,payload_json) VALUES (?,?,?) ON CONFLICT(session_id,component_id) DO UPDATE SET payload_json=excluded.payload_json',
        ).run(
          sessionId,
          componentId,
          JSON.stringify({
            schemaVersion: 1,
            calls: normalized.calls,
            inventory: currentInventory,
            source: currentSource.sourceCandidates ?? null,
            accountingComplete: true,
          }),
        );
      } else {
        const componentId = deriveComponentId(key, 'generated');
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
          savePropertyDecision(db, sessionId, componentId, propName, prop, {
            kind: 'review',
            producer: { kind: 'review', id: randomUUID(), sessionId, componentId },
            ...(prepared.get(JSON.stringify([componentId, propName])) ?? {}),
            reviewAuthority: prepared.get(JSON.stringify([componentId, propName]))?.model?.identity ?? null,
            defaultIntent:
              prepared.get(JSON.stringify([componentId, propName]))?.model?.defaultIntent ??
              (own(prop, '$default') ? { action: 'set', value: prop.$default } : { action: 'clear' }),
          });
          if (prop.$type === 'token' && prop.$category === 'design') {
            writeTokenPaths(componentId, propName, prop['$token.allowed'] ?? []);
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

    for (const component of components) {
      const owner = sources.find((source) =>
        component.componentId ? source.component_id === component.componentId : source.name === component.key,
      )!;
      assertPreservedRepresentationSelections(db, sessionId, owner.component_id);
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
): Array<{ key: string; componentId: string; entry: CDFComponentEntry }> {
  const components = db
    .prepare(
      `SELECT component_id, name, description FROM raw_components
       WHERE session_id = ? AND status IN ('generated','held') ORDER BY rowid`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    name: string;
    description: string | null;
  }>;

  if (components.length === 0) return [];

  const propertyDefinitions = new Map(
    loadPropertyDecisions(db, sessionId).map((decision) => [
      `${decision.componentId}::${decision.propertyName}`,
      decision,
    ]),
  );
  const props = db
    .prepare(
      `SELECT component_id, name, required, default_value, description,
              cdf_type, cdf_category, cdf_token_kind, position
       FROM raw_props
       WHERE session_id = ? AND cdf_type IS NOT NULL
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

  const tokenPaths = db
    .prepare(
      `SELECT component_id, prop_name, position, path
       FROM raw_prop_token_paths WHERE session_id = ? ORDER BY component_id, prop_name, position`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    prop_name: string;
    position: number;
    path: string;
  }>;

  // The extracted source default stays in raw_props. This sidecar is only
  // consulted for CDF projection, after confirming it still names a matching
  // DTCG leaf in this session.
  const resolvedDefaultPaths = getRawTokenNamePaths(db, sessionId);
  const tokenTypeByPath = new Map(
    (
      db.prepare('SELECT path, type FROM raw_tokens WHERE session_id = ?').all(sessionId) as Array<{
        path: string;
        type: string;
      }>
    ).map((token) => [token.path, token.type]),
  );

  const propsByComponent = indexRowsByKey(props, (p) => p.component_id);
  const allowedValuesByProp = indexRowsByKey(allowedValues, (av) => `${av.component_id}::${av.prop_name}`);
  const slotsByComponent = indexRowsByKey(slots, (s) => s.component_id);
  const allowedComponentsBySlot = indexRowsByKey(allowedComponents, (ac) => `${ac.component_id}::${ac.slot_name}`);
  const tokenPathsByProp = indexRowsByKey(tokenPaths, (t) => `${t.component_id}::${t.prop_name}`);
  const toTokenPaths = (rows: typeof tokenPaths | undefined): string[] | undefined =>
    rows === undefined ? undefined : rows.map((r) => r.path);

  return overlayRepresentationPlans(
    db,
    sessionId,
    components.map(({ component_id, name, description }) => {
      const compProps = propsByComponent.get(component_id) ?? [];

      const $properties: CDFComponentEntry['$properties'] = Object.create(null);
      for (const p of compProps) {
        const av = allowedValuesByProp.get(`${component_id}::${p.name}`);
        const propDef: CDFComponentEntry['$properties'][string] = {
          $type: p.cdf_type as CDFComponentEntry['$properties'][string]['$type'],
          $category: p.cdf_category as CDFComponentEntry['$properties'][string]['$category'],
        };
        if (p.required) propDef.$required = true;
        const isTokenProp = p.cdf_type === 'token' && p.cdf_category === 'design';
        const defaultReference = p.default_value;
        const resolvedDefault =
          isTokenProp && p.cdf_token_kind !== null && defaultReference !== null
            ? resolvedDefaultPaths[defaultReference]
            : undefined;
        const compatibleResolvedDefault =
          resolvedDefault !== undefined && tokenTypeByPath.get(resolvedDefault) === p.cdf_token_kind
            ? resolvedDefault
            : undefined;
        if (p.default_value !== null) {
          if (p.cdf_type === 'boolean') {
            propDef.$default = p.default_value === 'true';
          } else {
            propDef.$default = compatibleResolvedDefault ?? p.default_value;
          }
        }
        if (p.description !== null) propDef.$description = p.description;
        // A token prop's options list is design token paths, written below. Its
        // extracted variant names stay in the session as scoping input only.
        if (!isTokenProp && av && av.length > 0) propDef.$values = av.map((v) => v.value);
        if (p.cdf_token_kind !== null) propDef['$token.kind'] = p.cdf_token_kind;
        if (isTokenProp) {
          const allowed = toTokenPaths(tokenPathsByProp.get(`${component_id}::${p.name}`));
          if (allowed !== undefined && allowed.length > 0) propDef['$token.allowed'] = allowed;
        }
        const saved = propertyDefinitions.get(`${component_id}::${p.name}`);
        if (saved && saved.definition) {
          const exact = cloneJson(saved.definition);
          if (isTokenProp) {
            const inheritedDefault =
              (saved.decision as { defaultIntent?: { action?: string } } | null)?.defaultIntent?.action === 'absent';
            if (inheritedDefault && exact.$default === defaultReference && compatibleResolvedDefault !== undefined)
              exact.$default = compatibleResolvedDefault;
            const allowed = toTokenPaths(tokenPathsByProp.get(`${component_id}::${p.name}`));
            delete exact['$token.allowed'];
            if (allowed?.length) exact['$token.allowed'] = allowed;
          }
          $properties[p.name] = exact;
        } else $properties[p.name] = propDef;
      }

      const compSlots = slotsByComponent.get(component_id) ?? [];
      const $slots: NonNullable<CDFComponentEntry['$slots']> = Object.create(null);
      for (const s of compSlots) {
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
      const decisions = loadAcceptedSlotDecisions(db, sessionId);
      return {
        key: name,
        componentId: component_id,
        entry: projectAcceptedSlots(
          entry,
          decisions?.filter((slot) => slot.componentId === component_id),
        ),
      };
    }),
  );
}

export type ScopeComponentRow = {
  name: string;
  componentId: string;
  aiDecision: 'accepted' | 'rejected' | null;
  aiReason: string | null;
  modelingNotes?: string[];
  needsReview: boolean;
  slots: Array<{ name: string; allowedComponents: string[] }>;
  /** Extracted relationships for navigation, independent of accepted slot restrictions. */
  sourceRelationships?: Array<{ slot: string; components: string[] }>;
};

export interface ScopeDecisionProvenance {
  kind: 'direct' | 'closure' | 'unknown';
  roots: string[];
}

export interface ScopeDecisions {
  accepted: string[];
  rejected: string[];
  acceptedProvenance?: Record<string, ScopeDecisionProvenance>;
}

const unknownScopeProvenance: ScopeDecisionProvenance = { kind: 'unknown', roots: [] };

function validateScopeProvenance(
  name: string,
  value: ScopeDecisionProvenance | undefined,
  acceptedNames: Set<string>,
): ScopeDecisionProvenance {
  if (value === undefined) return unknownScopeProvenance;
  if (!value || !['direct', 'closure', 'unknown'].includes(value.kind) || !Array.isArray(value.roots)) {
    throw new Error(`Invalid saved scope provenance for ${name}`);
  }

  const roots = [...value.roots];
  if (roots.some((root) => typeof root !== 'string')) throw new Error(`Invalid saved scope roots for ${name}`);
  if (new Set(roots).size !== roots.length) throw new Error(`Duplicate saved scope roots for ${name}`);
  const sortedRoots = [...roots].sort((left, right) => left.localeCompare(right));
  if (roots.some((root, index) => root !== sortedRoots[index])) {
    throw new Error(`Saved scope roots for ${name} must be sorted`);
  }
  if (roots.some((root) => !acceptedNames.has(root))) {
    throw new Error(`Saved scope provenance for ${name} refers to a non-accepted root`);
  }

  if (value.kind === 'direct' && !roots.includes(name)) {
    throw new Error(`Direct scope provenance for ${name} must include itself as a root`);
  }
  if (value.kind === 'closure' && (roots.length === 0 || roots.includes(name))) {
    throw new Error(`Closure scope provenance for ${name} must refer to other accepted roots`);
  }
  if (value.kind === 'unknown' && roots.length !== 0) {
    throw new Error(`Unknown scope provenance for ${name} cannot have roots`);
  }
  return { kind: value.kind, roots };
}

/** Read only explicitly saved human choices; AI selection statuses are not scope choices. */
export function loadScopeDecisions(db: DatabaseSync, sessionId: string): ScopeDecisions | undefined {
  const rows = db
    .prepare(
      `SELECT sd.component_id, sd.component_name, sd.decision, sd.provenance_json, rc.name AS current_name
       FROM scope_decisions sd
       JOIN raw_components rc ON rc.session_id = sd.session_id AND rc.component_id = sd.component_id
       WHERE sd.session_id = ?
       ORDER BY sd.component_name, sd.component_id`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    component_name: string;
    decision: 'accepted' | 'rejected';
    provenance_json: string | null;
    current_name: string;
  }>;

  if (rows.length === 0) return undefined;
  const accepted = rows.filter((row) => row.decision === 'accepted').map((row) => row.component_name);
  const rejected = rows.filter((row) => row.decision === 'rejected').map((row) => row.component_name);
  const acceptedNames = new Set(accepted);
  const acceptedProvenance = Object.create(null) as Record<string, ScopeDecisionProvenance>;

  for (const row of rows) {
    if (row.current_name !== row.component_name) {
      throw new Error(`Saved scope choice no longer matches component ${row.component_id}`);
    }
    if (row.decision === 'rejected') {
      if (row.provenance_json !== null) throw new Error(`Rejected scope choice ${row.component_name} has provenance`);
      continue;
    }
    let provenance: ScopeDecisionProvenance | undefined;
    if (row.provenance_json !== null) {
      try {
        provenance = JSON.parse(row.provenance_json) as ScopeDecisionProvenance;
      } catch {
        throw new Error(`Saved scope provenance for ${row.component_name} is corrupt`);
      }
    }
    acceptedProvenance[row.component_name] = validateScopeProvenance(row.component_name, provenance, acceptedNames);
  }

  return { accepted, rejected, acceptedProvenance };
}

export function loadScopeComponents(db: DatabaseSync, sessionId: string): ScopeComponentRow[] {
  const exploration = loadExplorationRun(db, sessionId, 'components');
  if (exploration && exploration.status !== 'complete') return [];
  const acceptedSlots = loadAcceptedSlotDecisions(db, sessionId);
  const reports = exploration ? loadExplorationReports(db, sessionId, 'components') : [];
  const notesByComponent = new Map<string, Array<{ name: string; source: string; notes: string[] }>>();
  for (const report of reports) {
    for (const component of report.companion.components) {
      if (!component.componentId || !component.modelingNotes?.length) continue;
      const notes = notesByComponent.get(component.componentId) ?? [];
      notes.push({ name: component.name, source: component.source, notes: component.modelingNotes });
      notesByComponent.set(component.componentId, notes);
    }
  }
  const rows = db
    .prepare(
      `SELECT name, component_id, source, status, reject_reason, review_reasons, needs_review FROM raw_components
       WHERE session_id = ? AND (
         status IN ('extracted', 'accepted', 'rejected') OR
         component_id IN (SELECT component_id FROM scope_decisions WHERE session_id = ?)
       )
       ORDER BY name, component_id`,
    )
    .all(sessionId, sessionId) as Array<{
    name: string;
    component_id: string;
    source: string;
    status: string;
    reject_reason: string | null;
    review_reasons: string;
    needs_review: number;
  }>;

  if (rows.length === 0) return [];

  const slotRows = db
    .prepare(
      `SELECT component_id, name, position
       FROM raw_slots WHERE session_id = ? ORDER BY component_id, position`,
    )
    .all(sessionId) as Array<{
    component_id: string;
    name: string;
    position: number;
  }>;
  const allowedRows = db
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

  const slotsByComponent = indexRowsByKey(slotRows, (s) => s.component_id);
  const allowedBySlot = indexRowsByKey(allowedRows, (a) => `${a.component_id}::${a.slot_name}`);

  return rows.map((r) => {
    const reviewReasons = parseReviewReasons(r.review_reasons);
    const nonAuthorableReason = reviewReasons.find((reason) => reason.startsWith('non-authorable:'));
    const modelingNotes = [
      ...new Set(
        (notesByComponent.get(r.component_id) ?? [])
          .filter((component) => component.name === r.name && component.source === r.source)
          .flatMap((component) => component.notes),
      ),
    ];

    return {
      name: r.name,
      componentId: r.component_id,
      aiDecision: r.status === 'accepted' ? 'accepted' : r.status === 'rejected' ? 'rejected' : null,
      aiReason: r.reject_reason ?? nonAuthorableReason?.slice('non-authorable:'.length) ?? null,
      ...(modelingNotes.length > 0 ? { modelingNotes } : {}),
      needsReview: Boolean(r.needs_review),
      sourceRelationships: (slotsByComponent.get(r.component_id) ?? []).flatMap((slot) => {
        const components = (allowedBySlot.get(`${r.component_id}::${slot.name}`) ?? []).map(
          (allowed) => allowed.allowed_component,
        );
        return components.length > 0 ? [{ slot: slot.name, components }] : [];
      }),
      slots:
        acceptedSlots !== undefined
          ? acceptedSlots
              .filter(
                (slot) => slot.componentId === r.component_id && (slot.state === 'open' || slot.state === 'finite'),
              )
              .map((slot) => ({
                name: slot.slot,
                allowedComponents: slot.state === 'finite' ? slot.allowedComponents : [],
              }))
          : (slotsByComponent.get(r.component_id) ?? []).map((s) => ({
              name: s.name,
              allowedComponents: (allowedBySlot.get(`${r.component_id}::${s.name}`) ?? []).map(
                (a) => a.allowed_component,
              ),
            })),
    };
  });
}

export function applyScopeDecisions(db: DatabaseSync, sessionId: string, decisions: ScopeDecisions): ScopeDecisions {
  const now = new Date().toISOString();
  if (!Array.isArray(decisions.accepted) || !Array.isArray(decisions.rejected)) {
    throw new Error('Scope decisions must contain accepted and rejected name arrays');
  }
  const acceptedSet = new Set(decisions.accepted);
  const accepted = [...acceptedSet];
  const rejected = [...new Set(decisions.rejected)].filter((n) => !acceptedSet.has(n));

  const components = db
    .prepare('SELECT component_id, name FROM raw_components WHERE session_id = ? ORDER BY name, component_id')
    .all(sessionId) as Array<{ component_id: string; name: string }>;
  if (components.length === 0) throw new Error(`No components found for scope session ${sessionId}`);
  const componentByName = new Map<string, { component_id: string; name: string }>();
  for (const component of components) {
    if (componentByName.has(component.name))
      throw new Error(`Duplicate component name in scope session: ${component.name}`);
    componentByName.set(component.name, component);
  }

  const rejectedSet = new Set(rejected);
  const unknownNames = [...accepted, ...rejected].filter((name) => !componentByName.has(name));
  if (unknownNames.length > 0) throw new Error(`Unknown scope component name(s): ${unknownNames.join(', ')}`);
  const missingNames = components
    .map((component) => component.name)
    .filter((name) => !acceptedSet.has(name) && !rejectedSet.has(name));
  if (missingNames.length > 0) throw new Error(`Scope decisions omit component name(s): ${missingNames.join(', ')}`);

  const provenanceInput = decisions.acceptedProvenance ?? {};
  if (!provenanceInput || typeof provenanceInput !== 'object' || Array.isArray(provenanceInput)) {
    throw new Error('Scope provenance must be an object keyed by accepted component name');
  }
  const allDecisions = new Set([...accepted, ...rejected]);
  const provenanceNames = Object.keys(provenanceInput);
  const invalidProvenanceNames = provenanceNames.filter((name) => !acceptedSet.has(name));
  if (invalidProvenanceNames.length > 0) {
    throw new Error(
      `Scope provenance may only be supplied for accepted component(s): ${invalidProvenanceNames.join(', ')}`,
    );
  }
  if (allDecisions.size !== components.length)
    throw new Error('Scope decisions must partition every component exactly once');
  const acceptedProvenance = Object.fromEntries(
    accepted.map((name) => [
      name,
      validateScopeProvenance(
        name,
        Object.hasOwn(provenanceInput, name) ? provenanceInput[name] : undefined,
        acceptedSet,
      ),
    ]),
  );

  let transactionStarted = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    db.prepare('DELETE FROM scope_decisions WHERE session_id = ?').run(sessionId);
    const insert = db.prepare(
      `INSERT INTO scope_decisions (session_id, component_id, component_name, decision, provenance_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const update = db.prepare('UPDATE raw_components SET status = ? WHERE session_id = ? AND component_id = ?');
    for (const component of components) {
      const decision = acceptedSet.has(component.name) ? 'accepted' : 'rejected';
      const provenance = decision === 'accepted' ? JSON.stringify(acceptedProvenance[component.name]) : null;
      insert.run(sessionId, component.component_id, component.name, decision, provenance, now);
      update.run(decision === 'accepted' ? 'generated' : 'rejected', sessionId, component.component_id);
    }
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    db.exec('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) db.exec('ROLLBACK');
    throw error;
  }

  return { accepted, rejected, acceptedProvenance };
}

export function findLatestSessionForCommand(db: DatabaseSync, command: CommandName): string | null {
  return getLatestCompletedSessionForCommand(db, command);
}

export function seedCDFFromPriorSession(db: DatabaseSync, targetSessionId: string): number {
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

  return withTransaction(db, () => {
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
        const cdfType = mapContentfulTypeToCdfType(propSummary.type);
        const cdfCategory = resolveCdfCategory(propSummary.category, propName, contentProps, designProps);
        const result = updateStmt.run(cdfType, cdfCategory, sessionId, localComponent.component_id, propName);
        totalSeeded += Number(result.changes);
      }
    }

    return totalSeeded;
  });
}

export function seedDefaultsFromChangedItems(
  db: DatabaseSync,
  sessionId: string,
  changedItems: Array<{ current: ComponentTypeSummary; proposed: object }>,
): number {
  if (changedItems.length === 0) return 0;

  return withTransaction(db, () => {
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
        if (propSummary.default !== undefined && propSummary.default !== null) {
          const defaultStr =
            typeof propSummary.default === 'string' ? propSummary.default : JSON.stringify(propSummary.default);
          const result = updateDefaultStmt.run(defaultStr, sessionId, localComponent.component_id, propName);
          totalSeeded += Number(result.changes);
        }

        const cdfType = mapContentfulTypeToCdfType(propSummary.type);
        const cdfCategory = resolveCdfCategory(propSummary.category, propName, contentProps, designProps);
        const result = updateCDFStmt.run(cdfType, cdfCategory, sessionId, localComponent.component_id, propName);
        totalSeeded += Number(result.changes);
      }
    }

    return totalSeeded;
  });
}

export function backfillUnclassifiedProps(db: DatabaseSync, sessionId: string): number {
  const withCategory = db
    .prepare(
      `UPDATE raw_props SET cdf_type = 'string', cdf_category = category
     WHERE session_id = ? AND cdf_type IS NULL
       AND NOT EXISTS (SELECT 1 FROM raw_property_decisions decision WHERE decision.session_id=raw_props.session_id AND decision.component_id=raw_props.component_id AND decision.prop_name=raw_props.name AND 1=1)
       AND category IS NOT NULL
       AND component_id IN (
         SELECT component_id FROM raw_components WHERE session_id = ? AND status = 'generated'
       )`,
    )
    .run(sessionId, sessionId);

  const withoutCategory = db
    .prepare(
      `UPDATE raw_props SET cdf_type = 'string', cdf_category = 'content'
     WHERE session_id = ? AND cdf_type IS NULL
       AND NOT EXISTS (SELECT 1 FROM raw_property_decisions decision WHERE decision.session_id=raw_props.session_id AND decision.component_id=raw_props.component_id AND decision.prop_name=raw_props.name AND 1=1)
       AND category IS NULL
       AND component_id IN (
         SELECT component_id FROM raw_components WHERE session_id = ? AND status = 'generated'
       )`,
    )
    .run(sessionId, sessionId);

  return Number(withCategory.changes) + Number(withoutCategory.changes);
}

export type CacheEntityType = 'component' | 'token_set' | 'token_mapping';

export interface CacheEntry {
  inputHash: string;
  entityType: CacheEntityType;
  entityId: string;
  sourceSessionId: string;
  humanEdited: boolean;
  promptHash: string;
  createdAt: string;
  updatedAt: string;
}

export function computeMapTokensInputHash(
  db: DatabaseSync,
  sessionId: string,
  componentSourceRefs: readonly ComponentSourceRef[] = [],
): string {
  const props = db
    .prepare(
      `SELECT rc.name AS component_name, rp.name AS prop_name, rp.cdf_token_kind, rp.default_value
       FROM raw_props rp
       JOIN raw_components rc ON rc.session_id = rp.session_id AND rc.component_id = rp.component_id
       WHERE rp.session_id = ? AND rp.cdf_type = 'token' AND rp.cdf_category = 'design'
       ORDER BY rc.name, rp.name`,
    )
    .all(sessionId) as Array<{
    component_name: string;
    prop_name: string;
    cdf_token_kind: string | null;
    default_value: string | null;
  }>;

  const tokens = db
    .prepare(`SELECT path, type FROM raw_tokens WHERE session_id = ? ORDER BY path`)
    .all(sessionId) as Array<{ path: string; type: string }>;

  const defaultMappings = db
    .prepare('SELECT raw_name, path, source FROM raw_token_name_paths WHERE session_id = ? ORDER BY raw_name')
    .all(sessionId) as Array<{
    raw_name: string;
    path: string;
    source: RawTokenNamePathSource;
  }>;

  const payload = {
    props: props.map((p) => ({
      component: p.component_name,
      prop: p.prop_name,
      tokenKind: p.cdf_token_kind,
      rawDefault: p.default_value,
    })),
    tokens,
    defaultMappings,
    // The agent's evidence, not just its inputs: a comment or allowlist edit
    // in a source file (or a sibling it reads) changes the correct answer
    // without touching props or tokens, so it must invalidate the cache too.
    sourceRefs: [...componentSourceRefs]
      .sort((a, b) => a.component.localeCompare(b.component))
      .map((ref) => ({
        component: ref.component,
        content: ref.content,
        siblingFiles: (ref.siblingFiles ?? [])
          .map((s) => ({ path: s.path, content: s.content }))
          .sort((a, b) => a.path.localeCompare(b.path)),
        usesNotShown: [...(ref.usesNotShown ?? [])].sort(),
      })),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function lookupCache(
  db: DatabaseSync,
  inputHash: string,
  entityType: CacheEntityType,
  entityId: string,
  promptHash: string = '',
): CacheEntry | null {
  const row = db
    .prepare(
      `SELECT input_hash, entity_type, entity_id, source_session_id, human_edited, created_at, updated_at, prompt_hash
       FROM generation_cache
       WHERE input_hash = ? AND entity_type = ? AND entity_id = ? AND prompt_hash = ?`,
    )
    .get(inputHash, entityType, entityId, promptHash) as
    | {
        input_hash: string;
        entity_type: string;
        entity_id: string;
        source_session_id: string;
        human_edited: number;
        created_at: string;
        updated_at: string;
        prompt_hash: string;
      }
    | undefined;
  if (!row) return null;
  return {
    inputHash: row.input_hash,
    entityType: row.entity_type as CacheEntityType,
    entityId: row.entity_id,
    sourceSessionId: row.source_session_id,
    humanEdited: row.human_edited === 1,
    promptHash: row.prompt_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function lookupCacheByEntity(
  db: DatabaseSync,
  entityType: CacheEntityType,
  entityId: string,
): CacheEntry | null {
  const row = db
    .prepare(
      `SELECT input_hash, entity_type, entity_id, source_session_id, human_edited, created_at, updated_at, prompt_hash
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
        prompt_hash: string;
      }
    | undefined;
  if (!row) return null;
  return {
    inputHash: row.input_hash,
    entityType: row.entity_type as CacheEntityType,
    entityId: row.entity_id,
    sourceSessionId: row.source_session_id,
    humanEdited: row.human_edited === 1,
    promptHash: row.prompt_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function storeCache(
  db: DatabaseSync,
  inputHash: string,
  entityType: CacheEntityType,
  entityId: string,
  sourceSessionId: string,
  humanEdited: boolean,
  promptHash: string = '',
): void {
  storeCaches(db, [{ inputHash, entityType, entityId, sourceSessionId, humanEdited, promptHash }]);
}

export function storeCaches(
  db: DatabaseSync,
  entries: Array<{
    inputHash: string;
    entityType: CacheEntityType;
    entityId: string;
    sourceSessionId: string;
    humanEdited: boolean;
    promptHash?: string;
  }>,
): void {
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO generation_cache (input_hash, entity_type, entity_id, source_session_id, human_edited, created_at, updated_at, prompt_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(input_hash, prompt_hash, entity_type, entity_id) DO UPDATE SET
       source_session_id = excluded.source_session_id,
       human_edited = CASE WHEN generation_cache.human_edited = 1 THEN 1 ELSE excluded.human_edited END,
       updated_at = excluded.updated_at`,
  );
  db.exec('BEGIN');
  try {
    for (const entry of entries) {
      insert.run(
        entry.inputHash,
        entry.entityType,
        entry.entityId,
        entry.sourceSessionId,
        entry.humanEdited ? 1 : 0,
        now,
        now,
        entry.promptHash ?? '',
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function storeScannedFiles(
  db: DatabaseSync,
  sessionId: string,
  filePaths: string[],
  options?: { withinTransaction?: boolean },
): void {
  const ownsTransaction = !options?.withinTransaction;
  if (ownsTransaction) db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM scanned_files WHERE session_id = ?').run(sessionId);
    const insert = db.prepare('INSERT INTO scanned_files (session_id, path) VALUES (?, ?)');
    for (const path of filePaths) {
      insert.run(sessionId, path);
    }
    if (ownsTransaction) db.exec('COMMIT');
  } catch (e) {
    if (ownsTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

export function loadScannedFiles(db: DatabaseSync, sessionId: string): string[] {
  const rows = db.prepare('SELECT path FROM scanned_files WHERE session_id = ? ORDER BY path').all(sessionId) as Array<{
    path: string;
  }>;
  return rows.map((r) => r.path);
}

export function storeSlotCycles(
  db: DatabaseSync,
  sessionId: string,
  cycles: Array<SlotCycle & { suggestedBreak?: SlotEdge | null }>,
  options?: { withinTransaction?: boolean },
): void {
  const ownsTransaction = !options?.withinTransaction;
  if (ownsTransaction) db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM slot_cycles WHERE session_id = ?').run(sessionId);
    const insert = db.prepare(
      `INSERT INTO slot_cycles (session_id, cycle_index, path_json, edges_json, suggested_break_json)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < cycles.length; i += 1) {
      const cycle = cycles[i];
      insert.run(
        sessionId,
        i,
        JSON.stringify(cycle.path),
        JSON.stringify(cycle.edges),
        cycle.suggestedBreak ? JSON.stringify(cycle.suggestedBreak) : null,
      );
    }
    if (ownsTransaction) db.exec('COMMIT');
  } catch (e) {
    if (ownsTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

export interface SessionSourceEnvelope {
  schemaVersion: 1;
  envelopeId: string;
  digest: string;
  sessionId: string;
  extractionStepId: number;
  revision: 'source-evidence-v1';
  candidateDigests?: Record<string, string>;
  readiness: 'ready';
  extractionByteBinding: SourceCapture['extractionByteBinding'];
  capture: SourceCapture;
  observations: NonNullable<import('@contentful/experience-design-system-types').SharedSource['observations']>;
}

export interface SourceEvidenceHandle {
  envelopeId: string;
  digest: string;
  extractionStepId: number;
  coverage: SourceCapture['coverage'];
  readiness: 'ready';
}

export type CompletedSourceEvidence =
  | { readiness: 'ready'; handle: SourceEvidenceHandle; envelope: SessionSourceEnvelope }
  | { readiness: 'unavailable'; reason: string };

function candidateEvidenceDigest(
  component: Pick<RawComponentDefinition, 'factSchemaVersion' | 'sourceCandidates' | 'sourceCandidateSources'>,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        component.factSchemaVersion ?? null,
        component.sourceCandidates ?? null,
        component.sourceCandidateSources ?? [],
      ]),
    )
    .digest('hex');
}

function sourceEnvelopeDigest(payload: Omit<SessionSourceEnvelope, 'digest'>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function completeExtractionWithSourceEvidence(
  db: DatabaseSync,
  input: {
    sessionId: string;
    stepId: number;
    components: RawComponentDefinition[];
    cycles: Array<SlotCycle & { suggestedBreak?: SlotEdge | null }>;
    scannedFiles: string[];
    capture: SourceCapture;
    observations: NonNullable<import('@contentful/experience-design-system-types').SharedSource['observations']>;
    extractionDiagnostics?: ExtractionDiagnostics;
  },
): SourceEvidenceHandle {
  const step = db.prepare('SELECT session_id, status, command FROM steps WHERE id = ?').get(input.stepId) as
    | { session_id: string; status: string; command: string }
    | undefined;
  if (!step || step.session_id !== input.sessionId || step.status !== 'pending' || step.command !== 'analyze extract') {
    throw new Error('Extraction step is missing, belongs to another session, or is not pending');
  }
  const unavailableComponentFacts = new Map<number, RawComponentDefinition['componentFacts']>();
  const bindingComponents = input.components.map((component, index) => {
    const read = readComponentFacts(component.componentFacts);
    if (read.status === 'available') return { ...component, componentFacts: read.facts! };
    if (component.componentFacts === undefined) return component;
    unavailableComponentFacts.set(index, component.componentFacts);
    const { componentFacts: _facts, ...raw } = component;
    return raw;
  });
  const envelopeId = `source-${randomUUID()}`;
  if (input.capture.inventory && readSourceInventory(input.capture.inventory).status !== 'available')
    throw new Error('Invalid completed source inventory');
  const referenceIndexes = input.components.flatMap((component) => {
    const index = component.componentFacts?.sourceObservations?.referenceIndex;
    if (!index) return [];
    if (
      readSourceReferences(index).status !== 'available' ||
      index.componentDeclarationId !== component.componentFacts?.sourceObservations?.componentDeclarationId
    )
      throw new Error('Invalid completed source reference index');
    return [bindSavedSourceReferences(index, input.capture.files)];
  });
  const createdAt = new Date().toISOString();
  const payload: Omit<SessionSourceEnvelope, 'digest'> = {
    schemaVersion: 1,
    envelopeId,
    sessionId: input.sessionId,
    extractionStepId: input.stepId,
    revision: 'source-evidence-v1',
    candidateDigests: Object.fromEntries(
      bindSourceCandidatesToCapture(bindingComponents, input.capture.files).map((component) => [
        deriveComponentId(component.name, component.source),
        candidateEvidenceDigest(component),
      ]),
    ),
    readiness: 'ready',
    extractionByteBinding: input.capture.extractionByteBinding,
    capture: input.capture,
    observations: { ...input.observations, ...(referenceIndexes.length ? { referenceIndexes } : {}) },
  };
  const digest = sourceEnvelopeDigest(payload);
  const envelope: SessionSourceEnvelope = { ...payload, digest };
  const outputs = {
    sessionId: input.sessionId,
    compositionEvidence: JSON.stringify(input.observations.accepted),
    compositionRejections: JSON.stringify(input.observations.rejected),
    ...(input.observations.callerCoverage
      ? { compositionCallerCoverage: JSON.stringify(input.observations.callerCoverage) }
      : {}),
    sourceEnvelopeId: envelope.envelopeId,
    sourceEnvelopeDigest: envelope.digest,
    sourceExtractionStepId: String(input.stepId),
  };
  // Unavailable sidecars retain their read status without preventing valid candidate binding and final save.
  const boundComponents = bindSourceCandidatesToCapture(bindingComponents, input.capture.files, {
    captureId: envelope.capture.captureId,
    captureDigest: envelope.capture.digest,
    envelopeId: envelope.envelopeId,
    envelopeDigest: envelope.digest,
    sessionId: envelope.sessionId,
    extractionStepId: envelope.extractionStepId,
  }).map((component, index) =>
    unavailableComponentFacts.has(index)
      ? { ...component, componentFacts: unavailableComponentFacts.get(index) }
      : component,
  );

  db.exec('BEGIN');
  try {
    storeRawComponents(db, input.sessionId, boundComponents, {
      preserveStatus: true,
      preserveCDF: true,
      withinTransaction: true,
      extractionDiagnostics: bindCompilerReadsToCapture(input.extractionDiagnostics, input.capture.files),
    });
    storeSlotCycles(db, input.sessionId, input.cycles, { withinTransaction: true });
    storeScannedFiles(db, input.sessionId, input.scannedFiles, { withinTransaction: true });
    db.prepare(
      `INSERT INTO session_source_envelopes (envelope_id, session_id, step_id, digest, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(envelope.envelopeId, input.sessionId, input.stepId, envelope.digest, JSON.stringify(envelope), createdAt);
    updateStep(db, input.stepId, 'complete', outputs, undefined, { withinTransaction: true });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    envelopeId: envelope.envelopeId,
    digest: envelope.digest,
    extractionStepId: input.stepId,
    coverage: envelope.capture.coverage,
    readiness: 'ready',
  };
}

export function loadCompletedSourceEvidence(
  db: DatabaseSync,
  sessionId: string,
  expected?: Pick<SourceEvidenceHandle, 'envelopeId' | 'digest' | 'extractionStepId'>,
): CompletedSourceEvidence {
  const step = expected
    ? (db
        .prepare(
          `SELECT id, status, outputs FROM steps WHERE id = ? AND session_id = ? AND command = 'analyze extract'`,
        )
        .get(expected.extractionStepId, sessionId) as { id: number; status: string; outputs: string } | undefined)
    : (db
        .prepare(
          `SELECT id, status, outputs FROM steps WHERE session_id = ? AND command = 'analyze extract'
           ORDER BY id DESC LIMIT 1`,
        )
        .get(sessionId) as { id: number; status: string; outputs: string } | undefined);
  if (!step || step.status !== 'complete')
    return { readiness: 'unavailable', reason: 'completed-extraction-step-unavailable' };
  let outputs: Record<string, string>;
  try {
    outputs = JSON.parse(step.outputs) as Record<string, string>;
  } catch {
    return { readiness: 'unavailable', reason: 'completed-step-outputs-corrupt' };
  }
  if (
    outputs.sourceExtractionStepId !== String(step.id) ||
    !outputs.sourceEnvelopeId ||
    !outputs.sourceEnvelopeDigest ||
    (expected && (outputs.sourceEnvelopeId !== expected.envelopeId || outputs.sourceEnvelopeDigest !== expected.digest))
  ) {
    return { readiness: 'unavailable', reason: 'completed-step-source-identity-mismatch' };
  }
  const row = db
    .prepare(
      `SELECT envelope_id, session_id, step_id, digest, payload_json FROM session_source_envelopes WHERE envelope_id = ?`,
    )
    .get(outputs.sourceEnvelopeId) as
    | { envelope_id: string; session_id: string; step_id: number; digest: string; payload_json: string }
    | undefined;
  if (
    !row ||
    row.session_id !== sessionId ||
    row.step_id !== step.id ||
    row.envelope_id !== outputs.sourceEnvelopeId ||
    row.digest !== outputs.sourceEnvelopeDigest
  ) {
    return { readiness: 'unavailable', reason: 'saved-source-envelope-unavailable' };
  }
  try {
    const envelope = JSON.parse(row.payload_json) as SessionSourceEnvelope;
    const { digest, ...payload } = envelope;
    if (
      envelope.schemaVersion !== 1 ||
      envelope.sessionId !== sessionId ||
      envelope.extractionStepId !== step.id ||
      envelope.envelopeId !== row.envelope_id ||
      digest !== row.digest ||
      (envelope.capture.inventory !== undefined &&
        readSourceInventory(envelope.capture.inventory).status !== 'available') ||
      (envelope.observations.referenceIndexes !== undefined &&
        (!Array.isArray(envelope.observations.referenceIndexes) ||
          envelope.observations.referenceIndexes.some(
            (index) => readSourceReferences(index).status !== 'available',
          ))) ||
      digest !== sourceEnvelopeDigest(payload)
    ) {
      return { readiness: 'unavailable', reason: 'saved-source-envelope-corrupt' };
    }
    return {
      readiness: 'ready',
      envelope,
      handle: {
        envelopeId: envelope.envelopeId,
        digest: envelope.digest,
        extractionStepId: envelope.extractionStepId,
        coverage: envelope.capture.coverage,
        readiness: 'ready',
      },
    };
  } catch {
    return { readiness: 'unavailable', reason: 'saved-source-envelope-corrupt' };
  }
}

export interface StoredSlotCycle extends SlotCycle {
  suggestedBreak: SlotEdge | null;
}

export function loadSlotCycles(db: DatabaseSync, sessionId: string): StoredSlotCycle[] {
  const rows = db
    .prepare(
      'SELECT cycle_index, path_json, edges_json, suggested_break_json FROM slot_cycles WHERE session_id = ? ORDER BY cycle_index',
    )
    .all(sessionId) as Array<{
    cycle_index: number;
    path_json: string;
    edges_json: string;
    suggested_break_json: string | null;
  }>;
  return rows.map((r) => ({
    path: JSON.parse(r.path_json) as string[],
    edges: JSON.parse(r.edges_json) as SlotEdge[],
    suggestedBreak: r.suggested_break_json ? (JSON.parse(r.suggested_break_json) as SlotEdge) : null,
  }));
}

export function clearSlotCycles(db: DatabaseSync, sessionId: string): void {
  db.prepare('DELETE FROM slot_cycles WHERE session_id = ?').run(sessionId);
}

export function markCacheHumanEdited(db: DatabaseSync, entityType: 'component' | 'token_set', entityId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE generation_cache SET human_edited = 1, updated_at = ? WHERE entity_type = ? AND entity_id = ?`,
  ).run(now, entityType, entityId);
}

export interface UnknownSlotAllowedComponent {
  componentId: string;
  componentName: string;
  slotName: string;
  allowedComponent: string;
}

export function findUnknownSlotAllowedComponents(
  db: DatabaseSync,
  sessionId: string,
  allowedComponentNames: ReadonlySet<string>,
  componentId?: string,
): UnknownSlotAllowedComponent[] {
  const rows = db
    .prepare(
      `SELECT a.component_id, c.name AS component_name, a.slot_name, a.allowed_component
       FROM raw_slot_allowed_components a
       JOIN raw_components c ON c.session_id = a.session_id AND c.component_id = a.component_id
       WHERE a.session_id = ? AND (? IS NULL OR a.component_id = ?)
       ORDER BY a.component_id, a.slot_name, a.position`,
    )
    .all(sessionId, componentId ?? null, componentId ?? null) as Array<{
    component_id: string;
    component_name: string;
    slot_name: string;
    allowed_component: string;
  }>;

  return rows
    .filter((row) => !allowedComponentNames.has(row.allowed_component))
    .map((row) => ({
      componentId: row.component_id,
      componentName: row.component_name,
      slotName: row.slot_name,
      allowedComponent: row.allowed_component,
    }));
}

/** Remove slot references that cannot resolve in the current manifest or target space. */
export function filterUnknownSlotAllowedComponents(
  db: DatabaseSync,
  sessionId: string,
  allowedComponentNames: ReadonlySet<string>,
): UnknownSlotAllowedComponent[] {
  const unknown = findUnknownSlotAllowedComponents(db, sessionId, allowedComponentNames);
  if (unknown.length === 0) return unknown;

  db.exec('BEGIN');
  try {
    const remove = db.prepare(
      `DELETE FROM raw_slot_allowed_components
       WHERE session_id = ? AND component_id = ? AND slot_name = ? AND allowed_component = ?`,
    );
    for (const row of unknown) {
      remove.run(sessionId, row.componentId, row.slotName, row.allowedComponent);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return unknown;
}

export interface CopyComponentFromCacheOptions {
  allowedComponentNames?: ReadonlySet<string>;
}

export function copyComponentFromCache(
  db: DatabaseSync,
  sourceSessionId: string,
  targetSessionId: string,
  componentId: string,
  manageTransaction = true,
  options: CopyComponentFromCacheOptions = {},
): void {
  const now = new Date().toISOString();
  if (manageTransaction) db.exec('BEGIN');
  try {
    const srcComp = db
      .prepare(
        `SELECT description, status, component_description_rationale, props_rationale, slots_rationale
         FROM raw_components WHERE session_id = ? AND component_id = ?`,
      )
      .get(sourceSessionId, componentId) as
      | {
          description: string | null;
          status: string;
          component_description_rationale: string | null;
          props_rationale: string | null;
          slots_rationale: string | null;
        }
      | undefined;

    if (srcComp) {
      db.prepare(
        `UPDATE raw_components
         SET description = ?, status = ?, component_description_rationale = ?, props_rationale = ?, slots_rationale = ?, extracted_at = ?
         WHERE session_id = ? AND component_id = ?`,
      ).run(
        srcComp.description,
        srcComp.status,
        srcComp.component_description_rationale,
        srcComp.props_rationale,
        srcComp.slots_rationale,
        now,
        targetSessionId,
        componentId,
      );
    }

    const srcProps = db
      .prepare(
        `SELECT name, cdf_type, cdf_category, cdf_token_kind, required, description, default_value, rationale
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
      rationale: string | null;
    }>;

    for (const p of srcProps) {
      db.prepare(
        `UPDATE raw_props SET cdf_type = ?, cdf_category = ?, cdf_token_kind = ?, required = ?, description = ?, default_value = ?, rationale = ?
         WHERE session_id = ? AND component_id = ? AND name = ?`,
      ).run(
        p.cdf_type,
        p.cdf_category,
        p.cdf_token_kind,
        p.required,
        p.description,
        p.default_value,
        p.rationale,
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
      .prepare(`SELECT name, required, description, rationale FROM raw_slots WHERE session_id = ? AND component_id = ?`)
      .all(sourceSessionId, componentId) as Array<{
      name: string;
      required: number;
      description: string | null;
      rationale: string | null;
    }>;
    for (const s of srcSlots) {
      db.prepare(
        `UPDATE raw_slots SET required = ?, description = ?, rationale = ? WHERE session_id = ? AND component_id = ? AND name = ?`,
      ).run(s.required, s.description, s.rationale, targetSessionId, componentId, s.name);
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
    const allowedSAC = options.allowedComponentNames
      ? srcSAC.filter((sac) => options.allowedComponentNames!.has(sac.allowed_component))
      : srcSAC;
    for (const sac of allowedSAC) {
      insertSAC.run(targetSessionId, componentId, sac.slot_name, sac.allowed_component, sac.position);
    }

    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, targetSessionId);
    if (manageTransaction) db.exec('COMMIT');
  } catch (e) {
    if (manageTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

export function copyComponentsFromCache(
  db: DatabaseSync,
  entries: Array<{
    sourceSessionId: string;
    targetSessionId: string;
    componentId: string;
  }>,
  options: CopyComponentFromCacheOptions = {},
): void {
  if (entries.length === 0) return;
  db.exec('BEGIN');
  try {
    for (const entry of entries) {
      copyComponentFromCache(db, entry.sourceSessionId, entry.targetSessionId, entry.componentId, false, options);
    }
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

export function copyMapTokensFromCache(db: DatabaseSync, sourceSessionId: string, targetSessionId: string): number {
  const now = new Date().toISOString();
  let copiedCount = 0;
  db.exec('BEGIN');
  try {
    const sourceRows = db
      .prepare(
        `SELECT rc.name AS component_name, rptp.prop_name, rptp.source, rptp.position, rptp.path
         FROM raw_prop_token_paths rptp
         JOIN raw_components rc ON rc.session_id = rptp.session_id AND rc.component_id = rptp.component_id
         WHERE rptp.session_id = ?
         ORDER BY rc.name, rptp.prop_name, rptp.position`,
      )
      .all(sourceSessionId) as Array<{
      component_name: string;
      prop_name: string;
      source: RawPropTokenPathSource;
      position: number;
      path: string;
    }>;

    const targetComponents = db
      .prepare(`SELECT component_id, name FROM raw_components WHERE session_id = ?`)
      .all(targetSessionId) as Array<{ component_id: string; name: string }>;
    const targetIdByName = new Map(targetComponents.map((c) => [c.name, c.component_id]));

    const targetProps = new Set(
      (
        db.prepare(`SELECT component_id, name FROM raw_props WHERE session_id = ?`).all(targetSessionId) as Array<{
          component_id: string;
          name: string;
        }>
      ).map((p) => `${p.component_id}::${p.name}`),
    );

    const insertPath = db.prepare(
      `INSERT INTO raw_prop_token_paths (session_id, component_id, prop_name, source, position, path)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const clearedProps = new Set<string>();
    const copiedProps = new Set<string>();
    for (const row of sourceRows) {
      const targetComponentId = targetIdByName.get(row.component_name);
      if (!targetComponentId) continue;
      if (!targetProps.has(`${targetComponentId}::${row.prop_name}`)) continue;

      const propKey = `${targetComponentId}::${row.prop_name}`;
      if (!clearedProps.has(propKey)) {
        clearedProps.add(propKey);
        db.prepare(`DELETE FROM raw_prop_token_paths WHERE session_id = ? AND component_id = ? AND prop_name = ?`).run(
          targetSessionId,
          targetComponentId,
          row.prop_name,
        );
      }
      insertPath.run(targetSessionId, targetComponentId, row.prop_name, row.source, row.position, row.path);
      copiedProps.add(propKey);
    }
    copiedCount = copiedProps.size;

    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, targetSessionId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return copiedCount;
}

let _cliCacheVersionCache: string | null = null;

export async function getCliCacheVersion(): Promise<string> {
  if (_cliCacheVersionCache) return _cliCacheVersionCache;
  try {
    const { hashContent } = await import('../helpers/cache-keys.js');
    const { resolveSkillPath } = await import('../../../../agents/index.js');
    const skills: Array<'components' | 'tokens' | 'select'> = ['components', 'tokens', 'select'];
    const parts: string[] = [];
    for (const s of skills) {
      try {
        const p = resolveSkillPath(s);
        parts.push(readFileSync(p, 'utf8'));
      } catch {
        parts.push(`<missing:${s}>`);
      }
    }
    _cliCacheVersionCache = hashContent(parts.join('\n---\n'));
    return _cliCacheVersionCache;
  } catch {
    _cliCacheVersionCache = 'fallback';
    return _cliCacheVersionCache;
  }
}

export interface ExtractCacheEntry {
  filePath: string;
  fileHash: string;
  cliVersion: string;
  createdAt: string;
  updatedAt: string;
  components: RawComponentDefinition[];
}

export function storeExtractCache(
  db: DatabaseSync,
  filePath: string,
  fileHash: string,
  cliVersion: string,
  components: RawComponentDefinition[],
): void {
  const now = new Date().toISOString();
  const componentsJson = JSON.stringify(components);
  db.prepare(
    `INSERT INTO extract_cache (file_path, file_hash, cli_version, created_at, updated_at, components_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_hash, cli_version) DO UPDATE SET
       file_path = excluded.file_path,
       updated_at = excluded.updated_at,
       components_json = excluded.components_json`,
  ).run(filePath, fileHash, cliVersion, now, now, componentsJson);
}

export function lookupExtractCache(db: DatabaseSync, fileHash: string, cliVersion: string): ExtractCacheEntry | null {
  const row = db
    .prepare(
      `SELECT file_path, file_hash, cli_version, created_at, updated_at, components_json
       FROM extract_cache
       WHERE file_hash = ? AND cli_version = ?`,
    )
    .get(fileHash, cliVersion) as
    | {
        file_path: string;
        file_hash: string;
        cli_version: string;
        created_at: string;
        updated_at: string;
        components_json: string;
      }
    | undefined;
  if (!row) return null;
  let components: RawComponentDefinition[] = [];
  try {
    components = JSON.parse(row.components_json) as RawComponentDefinition[];
  } catch {
    return null;
  }
  return {
    filePath: row.file_path,
    fileHash: row.file_hash,
    cliVersion: row.cli_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    components,
  };
}

/**
 * Content-addressed cache for the composition resolver's raw agent output
 * (authored parser source or emitted-edge JSONL). Keyed by a hash of the
 * candidate files + producer identity (`composition-cache-key.ts`), scoped by
 * `cli_version` so a prompt/skill change invalidates stale entries. Replaces
 * the former on-disk `~/.contentful/.../composition-cache` store so all CLI
 * caches live in the one pipeline DB.
 */
export function storeCompositionCache(
  db: DatabaseSync,
  inputHash: string,
  cliVersion: string,
  agentOutput: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO composition_cache (input_hash, cli_version, agent_output, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(input_hash, cli_version) DO UPDATE SET
       agent_output = excluded.agent_output,
       updated_at = excluded.updated_at`,
  ).run(inputHash, cliVersion, agentOutput, now, now);
}

export function lookupCompositionCache(db: DatabaseSync, inputHash: string, cliVersion: string): string | null {
  const row = db
    .prepare(`SELECT agent_output FROM composition_cache WHERE input_hash = ? AND cli_version = ?`)
    .get(inputHash, cliVersion) as { agent_output: string } | undefined;
  return row ? row.agent_output : null;
}

export type SelectDecision = 'accepted' | 'rejected';

export interface SelectCacheEntry {
  componentHash: string;
  promptHash: string;
  cliVersion: string;
  decision: SelectDecision;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export function storeSelectCache(
  db: DatabaseSync,
  componentHash: string,
  promptHash: string,
  cliVersion: string,
  decision: SelectDecision,
  reason: string | null,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO select_cache (component_hash, prompt_hash, cli_version, decision, reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(component_hash, prompt_hash, cli_version) DO UPDATE SET
       decision = excluded.decision,
       reason = excluded.reason,
       updated_at = excluded.updated_at`,
  ).run(componentHash, promptHash, cliVersion, decision, reason, now, now);
}

export function lookupSelectCache(
  db: DatabaseSync,
  componentHash: string,
  promptHash: string,
  cliVersion: string,
): SelectCacheEntry | null {
  const row = db
    .prepare(
      `SELECT component_hash, prompt_hash, cli_version, decision, reason, created_at, updated_at
       FROM select_cache
       WHERE component_hash = ? AND prompt_hash = ? AND cli_version = ?`,
    )
    .get(componentHash, promptHash, cliVersion) as
    | {
        component_hash: string;
        prompt_hash: string;
        cli_version: string;
        decision: string;
        reason: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    componentHash: row.component_hash,
    promptHash: row.prompt_hash,
    cliVersion: row.cli_version,
    decision: row.decision as SelectDecision,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
