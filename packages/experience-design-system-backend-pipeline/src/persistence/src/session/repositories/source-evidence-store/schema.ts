import type { DatabaseSync } from 'node:sqlite';

export function initializeCapturedSourceStore(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS session_captured_source_roots (
    envelope_id TEXT PRIMARY KEY REFERENCES session_source_envelopes(envelope_id) ON DELETE CASCADE,
    descriptor_json TEXT NOT NULL CHECK(length(descriptor_json)<=65536),
    current INTEGER NOT NULL DEFAULT 1 CHECK(current IN(0,1))
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS session_source_validation_receipts (
    store_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    step_id INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    descriptor_json TEXT NOT NULL CHECK(length(descriptor_json)<=65536),
    physical_identity TEXT NOT NULL CHECK(length(physical_identity)<=8192),
    catalog_identity TEXT NOT NULL CHECK(length(catalog_identity)<=8192),
    PRIMARY KEY(store_id,revision)
  ) WITHOUT ROWID;
  CREATE TRIGGER IF NOT EXISTS session_source_validation_receipts_immutable
  BEFORE UPDATE ON session_source_validation_receipts
  BEGIN SELECT RAISE(ABORT,'source validation receipts are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS session_captured_source_roots_immutable
  BEFORE UPDATE ON session_captured_source_roots
  WHEN NEW.envelope_id IS NOT OLD.envelope_id OR NEW.descriptor_json IS NOT OLD.descriptor_json
    OR (NEW.current IS NOT OLD.current AND NEW.current<>0)
  BEGIN SELECT RAISE(ABORT,'captured source roots are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS session_captured_source_step_current
  AFTER UPDATE OF status,outputs,session_id,command ON steps
  BEGIN
    UPDATE session_captured_source_roots SET current=0 WHERE envelope_id IN (
      SELECT e.envelope_id FROM session_source_envelopes e WHERE e.step_id=NEW.id AND (
        NEW.status<>'complete' OR NEW.command<>'analyze extract' OR NEW.session_id<>e.session_id
        OR CASE WHEN json_valid(NEW.outputs) THEN
          json_extract(NEW.outputs,'$.sourceEnvelopeId') IS NOT e.envelope_id
          OR json_extract(NEW.outputs,'$.sourceEnvelopeDigest') IS NOT e.digest
          OR json_extract(NEW.outputs,'$.sourceExtractionStepId') IS NOT CAST(NEW.id AS TEXT)
          ELSE 1 END
      )
    );
  END;`);
}
