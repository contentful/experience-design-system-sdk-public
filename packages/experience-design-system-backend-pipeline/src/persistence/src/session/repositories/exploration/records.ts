import { randomUUID, createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AgentCallAttempt,
  ExploreScopeResult,
  ExplorationIdentity,
  SlotDecision,
  DerivedSelection,
  CDFComponentEntry,
} from '@contentful/experience-design-system-types';
import { withTransaction } from '../shared/with-transaction.js';
import { loadRawComponents } from '../db.js';
import {
  bindAcceptedSlotSourceInput,
  validateAcceptedSourceOwners,
  validateCDFSourceOwners,
} from '../../../../../steps/exploration/src/services/source-input-ownership.js';
export type ExplorationPhase = 'components' | 'detail';
export interface ExplorationRun extends ExplorationIdentity {
  phase: ExplorationPhase;
  status: 'pending' | 'complete' | 'failed' | 'cancelled';
  error?: string;
  componentRunId?: string;
  scopeDigest?: string;
}
function readRun(db: DatabaseSync, runId: string): ExplorationRun {
  const row = db.prepare('SELECT * FROM exploration_runs WHERE id = ?').get(runId) as
    | {
        id: string;
        session_id: string;
        phase: ExplorationPhase;
        envelope_id: string;
        source_digest: string;
        status: ExplorationRun['status'];
        error: string | null;
        component_run_id: string | null;
        scope_digest: string | null;
      }
    | undefined;
  if (!row) throw new Error('Exploration run unavailable');
  return {
    sessionId: row.session_id,
    runId: row.id,
    phase: row.phase,
    envelopeId: row.envelope_id,
    digest: row.source_digest,
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    ...(row.component_run_id ? { componentRunId: row.component_run_id } : {}),
    ...(row.scope_digest ? { scopeDigest: row.scope_digest } : {}),
  };
}
export function loadExplorationRun(
  db: DatabaseSync,
  sessionId: string,
  phase: ExplorationPhase,
): ExplorationRun | undefined {
  const current = db
    .prepare('SELECT run_id FROM exploration_current WHERE session_id = ? AND phase = ?')
    .get(sessionId, phase) as { run_id: string } | undefined;
  return current ? readRun(db, current.run_id) : undefined;
}
function sourceMatches(db: DatabaseSync, run: ExplorationRun): boolean {
  const row = db
    .prepare(
      'SELECT envelope_id, digest FROM session_source_envelopes WHERE session_id = ? ORDER BY step_id DESC LIMIT 1',
    )
    .get(run.sessionId) as { envelope_id: string; digest: string } | undefined;
  return (
    row?.envelope_id === run.envelopeId &&
    row.digest === run.digest &&
    (run.phase !== 'detail' ||
      (run.componentRunId === loadExplorationRun(db, run.sessionId, 'components')?.runId &&
        run.scopeDigest === scopeDigest(db, run.sessionId)))
  );
}
function scopeDigest(db: DatabaseSync, sessionId: string): string {
  const rows = db
    .prepare(
      'SELECT component_id,component_name,decision,provenance_json FROM scope_decisions WHERE session_id=? ORDER BY component_id',
    )
    .all(sessionId);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function assertCurrent(db: DatabaseSync, runId: string, pending = true): ExplorationRun {
  const run = readRun(db, runId);
  if (
    loadExplorationRun(db, run.sessionId, run.phase)?.runId !== runId ||
    !sourceMatches(db, run) ||
    (pending && run.status !== 'pending')
  )
    throw new Error('Stale exploration run or source');
  return run;
}
export function beginExplorationRun(
  db: DatabaseSync,
  identity: Omit<ExplorationIdentity, 'runId'> & { phase: ExplorationPhase },
): ExplorationRun {
  const parent = identity.phase === 'detail' ? loadExplorationRun(db, identity.sessionId, 'components') : undefined;
  if (identity.phase === 'detail' && parent?.status !== 'complete')
    throw new Error('Completed component exploration is required for detail');
  const run: ExplorationRun = {
    ...identity,
    runId: randomUUID(),
    status: 'pending',
    ...(parent ? { componentRunId: parent.runId, scopeDigest: scopeDigest(db, identity.sessionId) } : {}),
  };
  if (!sourceMatches(db, run)) throw new Error('Exploration source identity mismatch');
  withTransaction(db, () => {
    db.prepare(
      'INSERT INTO exploration_runs (id,session_id,phase,envelope_id,source_digest,component_run_id,scope_digest,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(
      run.runId,
      run.sessionId,
      run.phase,
      run.envelopeId,
      run.digest,
      run.componentRunId ?? null,
      run.scopeDigest ?? null,
      run.status,
      new Date().toISOString(),
    );
    db.prepare(
      'INSERT INTO exploration_current (session_id,phase,run_id) VALUES (?,?,?) ON CONFLICT(session_id,phase) DO UPDATE SET run_id=excluded.run_id',
    ).run(run.sessionId, run.phase, run.runId);
  });
  return run;
}
export function storeExplorationAttempt(db: DatabaseSync, runId: string, attempt: AgentCallAttempt): void {
  const run = readRun(db, runId);
  if (
    run.status !== 'pending' ||
    (attempt.identity &&
      (attempt.identity.runId !== runId ||
        attempt.identity.sessionId !== run.sessionId ||
        attempt.identity.envelopeId !== run.envelopeId ||
        attempt.identity.digest !== run.digest))
  )
    throw new Error('Attempt does not belong to the pending exploration run');
  const key = JSON.stringify([attempt.operationId, attempt.stage, attempt.scope, attempt.component, attempt.attempt]);
  db.prepare('INSERT OR REPLACE INTO exploration_attempts (run_id,attempt_key,payload_json) VALUES (?,?,?)').run(
    runId,
    key,
    JSON.stringify(attempt),
  );
  if (attempt.scope) {
    const row = db
      .prepare('SELECT payload_json FROM exploration_reports WHERE run_id=? AND scope=?')
      .get(runId, attempt.scope) as { payload_json: string } | undefined;
    if (row) {
      const report = JSON.parse(row.payload_json) as ExploreScopeResult;
      report.attempts = report.attempts.filter(
        (before) => !(before.operationId === attempt.operationId && before.attempt === attempt.attempt),
      );
      report.attempts.push({ ...attempt, scope: attempt.scope });
      db.prepare('UPDATE exploration_reports SET payload_json=? WHERE run_id=? AND scope=?').run(
        JSON.stringify(report),
        runId,
        attempt.scope,
      );
    }
  }
}
export function storeExplorationReport(db: DatabaseSync, runId: string, report: ExploreScopeResult): void {
  assertCurrent(db, runId);
  db.prepare('INSERT OR REPLACE INTO exploration_reports (run_id,scope,payload_json) VALUES (?,?,?)').run(
    runId,
    report.scope,
    JSON.stringify(report),
  );
}
export function loadExplorationReports(
  db: DatabaseSync,
  sessionId: string,
  phase: ExplorationPhase,
): ExploreScopeResult[] {
  const run = loadExplorationRun(db, sessionId, phase);
  if (!run) return [];
  const rows = db
    .prepare('SELECT payload_json FROM exploration_reports WHERE run_id = ? ORDER BY scope')
    .all(run.runId) as Array<{ payload_json: string }>;
  return rows.map((row) => JSON.parse(row.payload_json) as ExploreScopeResult);
}
export function loadExplorationAttempts(
  db: DatabaseSync,
  sessionId: string,
  phase: ExplorationPhase,
): AgentCallAttempt[] {
  const run = loadExplorationRun(db, sessionId, phase);
  if (!run) return [];
  return (
    db
      .prepare('SELECT payload_json FROM exploration_attempts WHERE run_id = ? ORDER BY rowid')
      .all(run.runId) as Array<{ payload_json: string }>
  ).map((row) => JSON.parse(row.payload_json) as AgentCallAttempt);
}
export function loadExplorationRecord<T>(
  db: DatabaseSync,
  sessionId: string,
  phase: ExplorationPhase,
  family: 'inclusion' | 'slots' | 'detail',
): T | undefined {
  const run = loadExplorationRun(db, sessionId, phase);
  if (!run || run.status !== 'complete' || !sourceMatches(db, run)) return undefined;
  const row = db
    .prepare('SELECT payload_json FROM exploration_records WHERE run_id = ? AND family = ?')
    .get(run.runId, family) as { payload_json: string } | undefined;
  return row ? (JSON.parse(row.payload_json) as T) : undefined;
}
export function publishExplorationRun(
  db: DatabaseSync,
  runId: string,
  records: { inclusion?: DerivedSelection[]; slots?: SlotDecision[]; detail?: unknown },
): void {
  const run = assertCurrent(db, runId);
  if (run.phase === 'components' && (!records.inclusion || !records.slots))
    throw new Error('Component phase must publish inclusion and slots together');
  if (run.phase === 'detail' && records.detail === undefined) throw new Error('Detail phase record missing');
  const components = db
    .prepare('SELECT component_id,name,source FROM raw_components WHERE session_id = ?')
    .all(run.sessionId) as Array<{ component_id: string; name: string; source: string }>;
  const validate = (value: { name: string; source: string; componentId?: string }): void => {
    if (
      !components.some(
        (component) =>
          component.name === value.name &&
          component.source === value.source &&
          component.component_id === value.componentId,
      )
    )
      throw new Error('Accepted result component/source identity mismatch');
  };
  records.inclusion?.forEach(validate);
  records.slots?.forEach(validate);
  const rawComponents = records.slots ? loadRawComponents(db, run.sessionId) : [];
  const published = records.slots
    ? {
        ...records,
        slots: records.slots.map((decision) => {
          const component = rawComponents.find((component) => component.component_id === decision.componentId);
          if (!component) throw new Error('Accepted source owner component unavailable');
          return bindAcceptedSlotSourceInput(component, decision);
        }),
      }
    : records;
  if (published.slots)
    for (const component of rawComponents)
      validateAcceptedSourceOwners(
        component,
        published.slots.filter((slot) => slot.componentId === component.component_id),
      );
  withTransaction(db, () => {
    assertCurrent(db, runId);
    for (const [family, payload] of Object.entries(published))
      db.prepare('INSERT OR REPLACE INTO exploration_records (run_id,family,payload_json) VALUES (?,?,?)').run(
        runId,
        family,
        JSON.stringify(payload),
      );
    if (records.inclusion) {
      const update = db.prepare(
        'UPDATE raw_components SET status=?,reject_reason=?,needs_review=MAX(needs_review,?) WHERE session_id=? AND component_id=?',
      );
      for (const decision of records.inclusion)
        update.run(
          decision.decision ?? 'extracted',
          decision.reason,
          decision.disputed ? 1 : 0,
          run.sessionId,
          decision.componentId!,
        );
    }
    db.prepare("UPDATE exploration_runs SET status='complete' WHERE id=?").run(runId);
  });
}
export function failExplorationRun(db: DatabaseSync, runId: string, error: string, cancelled = false): void {
  const run = readRun(db, runId);
  if (run.status === 'complete') throw new Error('Completed exploration run cannot fail');
  db.prepare('UPDATE exploration_runs SET status=?,error=? WHERE id=?').run(
    cancelled ? 'cancelled' : 'failed',
    error,
    runId,
  );
}
export function loadAcceptedSlotDecisions(db: DatabaseSync, sessionId: string): SlotDecision[] | undefined {
  const current = loadExplorationRun(db, sessionId, 'components');
  if (!current) return undefined;
  if (current.status !== 'complete' || !sourceMatches(db, current))
    throw new Error('Accepted slot source authority is stale or incomplete');
  const components = loadRawComponents(db, sessionId);
  const decisions = (loadExplorationRecord<SlotDecision[]>(db, sessionId, 'components', 'slots') ?? []).map(
    (decision) => {
      const component = components.find((component) => component.component_id === decision.componentId);
      if (!component) throw new Error('Accepted source owner component unavailable');
      return bindAcceptedSlotSourceInput(component, decision);
    },
  );
  for (const component of components)
    validateAcceptedSourceOwners(
      component,
      decisions.filter((decision) => decision.componentId === component.component_id),
    );
  return decisions;
}
export function saveReviewedSlots(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  entry: CDFComponentEntry,
): void {
  const run = loadExplorationRun(db, sessionId, 'components');
  if (!run || run.status !== 'complete') throw new Error('No accepted exploration phase for slot edit');
  assertCurrent(db, run.runId, false);
  const previous = loadAcceptedSlotDecisions(db, sessionId) ?? [];
  const component = db
    .prepare('SELECT name,source FROM raw_components WHERE session_id=? AND component_id=?')
    .get(sessionId, componentId) as { name: string; source: string } | undefined;
  if (!component) throw new Error('Reviewed component identity unavailable');
  const raw = loadRawComponents(db, sessionId).find((raw) => raw.component_id === componentId);
  if (!raw) throw new Error('Reviewed source owner unavailable');
  validateCDFSourceOwners(raw, entry);
  const names = new Set([
    ...previous.filter((slot) => slot.componentId === componentId).map((slot) => slot.slot),
    ...Object.keys(entry.$slots ?? {}),
  ]);
  const next = previous.filter((slot) => slot.componentId !== componentId);
  for (const name of names) {
    const slot = entry.$slots?.[name];
    const before = previous.find((previous) => previous.componentId === componentId && previous.slot === name);
    if (!slot && before && (before.state === 'false' || before.state === 'unresolved')) {
      next.push({ ...before, ...component });
      continue;
    }
    const state = slot ? (slot.$allowedComponents?.length ? 'finite' : 'open') : 'false';
    if (
      before &&
      slot &&
      before.state === state &&
      before.required === slot.$required &&
      before.description === slot.$description &&
      JSON.stringify(before.sourceInput) === JSON.stringify(slot.$sourceInput) &&
      JSON.stringify(before.allowedComponents) === JSON.stringify(slot.$allowedComponents ?? [])
    ) {
      next.push({ ...before, ...component });
      continue;
    }
    next.push({
      ...before,
      ...component,
      componentId,
      slot: name,
      state: slot ? (slot.$allowedComponents?.length ? 'finite' : 'open') : 'false',
      allowedComponents: slot?.$allowedComponents ?? [],
      required: slot?.$required,
      evidence: before?.evidence ?? [],
      coverage: before?.coverage ?? 0,
      realVotes: before?.realVotes ?? 0,
      provenance: 'human',
      description: slot?.$description,
      sourceInput: slot?.$sourceInput,
    });
  }
  db.prepare("UPDATE exploration_records SET payload_json=? WHERE run_id=? AND family='slots'").run(
    JSON.stringify(next),
    run.runId,
  );
}
