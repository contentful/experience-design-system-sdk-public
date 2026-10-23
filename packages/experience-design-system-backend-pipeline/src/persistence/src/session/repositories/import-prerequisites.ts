import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  contentDigest,
  cloneJson,
  own,
  DESIGN_TOKEN_TYPES,
  LOCAL_NATIVE_PROPERTY_PROFILE,
  validateImportPrerequisites,
  definitionImportCapabilityStatus,
  parseCDFComponents,
  type CDFDocument,
  type DesignTokenType,
  type ImportPrerequisitePlan,
} from '@contentful/experience-design-system-types';
import { withTransaction } from './shared/with-transaction.js';
import type { ExistingContentfulEntities } from '../../../../steps/generation/src/types/existing-entities.js';

export interface PrerequisiteTarget {
  host?: string;
  spaceId: string;
  environmentId: string;
}
export interface SessionPrerequisiteSnapshot {
  revision: 1;
  sessionId: string;
  snapshotId: string;
  captureId: string;
  capturedAt: string;
  sourceIdentity: string;
  profileIdentity: string;
  targetIdentity: string;
  coverage: { Component: 'complete' | 'partial'; DesignToken: 'complete' | 'partial' };
  componentIds: string[];
  tokens: Array<{ targetId: string; kind: DesignTokenType }>;
  referenceMappings: Record<string, { targetId: string; captureId: string }>;
  snapshotHash: string;
}
export interface SessionPrerequisiteSaveReceipt {
  revision: 1;
  sessionId: string;
  sourceIdentity: string;
  profileIdentity: string;
  cdfHash: string;
  graphIdentity: string;
  targetIdentity: string | null;
  snapshotHash: string | null;
  receiptHash: string;
}

function initialize(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS session_prerequisite_snapshots (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    snapshot_hash TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(session_id, snapshot_hash)
  );
  CREATE TABLE IF NOT EXISTS session_prerequisite_receipts (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    receipt_hash TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(session_id, receipt_hash)
  )`);
}
function sourceIdentity(db: DatabaseSync, sessionId: string): string {
  const rows = db
    .prepare(
      `SELECT component_id, fact_schema_version, candidates_json, alternate_sources_json, component_facts_json
    FROM raw_component_source_evidence WHERE session_id=? ORDER BY component_id`,
    )
    .all(sessionId);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function profileIdentity(): string {
  return contentDigest(LOCAL_NATIVE_PROPERTY_PROFILE);
}
export function prerequisiteTargetIdentity(target: PrerequisiteTarget): string {
  return contentDigest({
    host: (target.host ?? 'api.contentful.com')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, ''),
    spaceId: target.spaceId.trim(),
    environmentId: target.environmentId.trim(),
  });
}
function payloadHash(payload: unknown, key: 'snapshotHash' | 'receiptHash'): string {
  const value = cloneJson(payload) as Record<string, unknown>;
  delete value[key];
  return contentDigest(value);
}
function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

/** Bind a completed catalogue fetch without treating resource names as identifier mappings. */
export function bindCatalogueCaptureToSession(
  db: DatabaseSync,
  sessionId: string,
  target: PrerequisiteTarget,
  entities: ExistingContentfulEntities,
): SessionPrerequisiteSnapshot {
  return withTransaction(db, () => {
    initialize(db);
    const tokens: SessionPrerequisiteSnapshot['tokens'] = [];
    const componentIds: string[] = [];
    let componentsComplete = true;
    for (const component of entities.components) {
      const id = component.sys?.id;
      if (typeof id !== 'string' || !id.trim() || componentIds.includes(id)) {
        componentsComplete = false;
        continue;
      }
      componentIds.push(id);
    }
    const ids = new Set<string>();
    let complete = true;
    for (const token of entities.tokens) {
      const id = token.sys?.id;
      const kind = token.type;
      if (
        typeof id !== 'string' ||
        !id.trim() ||
        ids.has(id) ||
        !(DESIGN_TOKEN_TYPES as readonly unknown[]).includes(kind)
      ) {
        complete = false;
        continue;
      }
      ids.add(id);
      tokens.push({ targetId: id, kind: kind as DesignTokenType });
    }
    const draft: SessionPrerequisiteSnapshot = {
      revision: 1,
      sessionId,
      snapshotId: randomUUID(),
      captureId: randomUUID(),
      capturedAt: new Date().toISOString(),
      sourceIdentity: sourceIdentity(db, sessionId),
      profileIdentity: profileIdentity(),
      targetIdentity: prerequisiteTargetIdentity(target),
      coverage: {
        Component: componentsComplete ? 'complete' : 'partial',
        DesignToken: complete ? 'complete' : 'partial',
      },
      componentIds,
      tokens,
      referenceMappings: Object.create(null),
      snapshotHash: '',
    };
    draft.snapshotHash = payloadHash(draft, 'snapshotHash');
    db.prepare('INSERT INTO session_prerequisite_snapshots(session_id,snapshot_hash,payload_json) VALUES(?,?,?)').run(
      sessionId,
      draft.snapshotHash,
      JSON.stringify(draft),
    );
    return cloneJson(draft);
  });
}

export function loadBoundSessionPrerequisiteSnapshot(
  db: DatabaseSync,
  sessionId: string,
  target: PrerequisiteTarget,
  snapshotHash?: string,
): SessionPrerequisiteSnapshot | undefined {
  if (!tableExists(db, 'session_prerequisite_snapshots')) return;
  const row = db
    .prepare(
      snapshotHash === undefined
        ? 'SELECT payload_json,snapshot_hash FROM session_prerequisite_snapshots WHERE session_id=? ORDER BY rowid DESC LIMIT 1'
        : 'SELECT payload_json,snapshot_hash FROM session_prerequisite_snapshots WHERE session_id=? AND snapshot_hash=?',
    )
    .get(...(snapshotHash === undefined ? [sessionId] : [sessionId, snapshotHash])) as
    | { payload_json: string; snapshot_hash: string }
    | undefined;
  if (!row) return;
  try {
    const value = JSON.parse(row.payload_json) as SessionPrerequisiteSnapshot;
    if (
      value.revision !== 1 ||
      value.sessionId !== sessionId ||
      !value.snapshotId ||
      !value.captureId ||
      !value.capturedAt ||
      !value.coverage ||
      !['complete', 'partial'].includes(value.coverage.Component) ||
      !['complete', 'partial'].includes(value.coverage.DesignToken) ||
      !Array.isArray(value.componentIds) ||
      value.componentIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      new Set(value.componentIds).size !== value.componentIds.length ||
      !Array.isArray(value.tokens) ||
      new Set(value.tokens.map((token) => token.targetId)).size !== value.tokens.length ||
      value.tokens.some((token) => !token.targetId || !DESIGN_TOKEN_TYPES.includes(token.kind)) ||
      !value.referenceMappings ||
      typeof value.referenceMappings !== 'object' ||
      Array.isArray(value.referenceMappings) ||
      value.sourceIdentity !== sourceIdentity(db, sessionId) ||
      value.profileIdentity !== profileIdentity() ||
      value.targetIdentity !== prerequisiteTargetIdentity(target) ||
      value.snapshotHash !== row.snapshot_hash ||
      value.snapshotHash !== payloadHash(value, 'snapshotHash')
    )
      return;
    return cloneJson(value);
  } catch {
    return;
  }
}

export function setSessionTokenReferenceMapping(
  db: DatabaseSync,
  sessionId: string,
  target: PrerequisiteTarget,
  reference: string,
  targetId: string,
): void {
  return withTransaction(db, () => {
    const snapshot = loadBoundSessionPrerequisiteSnapshot(db, sessionId, target);
    if (!snapshot || !reference.trim() || !targetId.trim())
      throw new Error('Token mapping requires explicit identifiers and a current bound catalogue');
    if (own(snapshot.referenceMappings, reference) && snapshot.referenceMappings[reference].targetId === targetId)
      return;
    snapshot.snapshotId = randomUUID();
    Object.defineProperty(snapshot.referenceMappings, reference, {
      value: { targetId, captureId: snapshot.captureId },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    snapshot.snapshotHash = payloadHash(snapshot, 'snapshotHash');
    db.prepare('INSERT INTO session_prerequisite_snapshots(session_id,snapshot_hash,payload_json) VALUES(?,?,?)').run(
      sessionId,
      snapshot.snapshotHash,
      JSON.stringify(snapshot),
    );
  });
}

export function createSessionPrerequisiteSaveReceipt(
  db: DatabaseSync,
  sessionId: string,
  cdf: CDFDocument,
  target?: PrerequisiteTarget,
): SessionPrerequisiteSaveReceipt {
  return withTransaction(db, () => {
    const validation = validateImportPrerequisites(parseCDFComponents(cdf));
    if (!validation.valid) throw new Error(validation.errors.map((issue) => issue.message).join('; '));
    const snapshot = target ? loadBoundSessionPrerequisiteSnapshot(db, sessionId, target) : undefined;
    const receipt: SessionPrerequisiteSaveReceipt = {
      revision: 1,
      sessionId,
      sourceIdentity: sourceIdentity(db, sessionId),
      profileIdentity: profileIdentity(),
      cdfHash: contentDigest(cdf),
      graphIdentity: validation.plan.graphIdentity,
      targetIdentity: target ? prerequisiteTargetIdentity(target) : null,
      snapshotHash: snapshot?.snapshotHash ?? null,
      receiptHash: '',
    };
    receipt.receiptHash = payloadHash(receipt, 'receiptHash');
    initialize(db);
    db.prepare(
      'INSERT OR IGNORE INTO session_prerequisite_receipts(session_id,receipt_hash,payload_json) VALUES(?,?,?)',
    ).run(sessionId, receipt.receiptHash, JSON.stringify(receipt));
    return cloneJson(receipt);
  });
}

export function verifyLocalSavedPrerequisiteReceipt(
  db: DatabaseSync,
  receipt: SessionPrerequisiteSaveReceipt,
  cdf: CDFDocument,
  target?: PrerequisiteTarget,
): boolean {
  if (!tableExists(db, 'session_prerequisite_receipts')) return false;
  try {
    const stored = db
      .prepare('SELECT payload_json FROM session_prerequisite_receipts WHERE session_id=? AND receipt_hash=?')
      .get(receipt.sessionId, receipt.receiptHash) as { payload_json: string } | undefined;
    const validation = validateImportPrerequisites(parseCDFComponents(cdf));
    const snapshot =
      target && receipt.snapshotHash
        ? loadBoundSessionPrerequisiteSnapshot(db, receipt.sessionId, target, receipt.snapshotHash)
        : undefined;
    return Boolean(
      stored &&
      contentDigest(JSON.parse(stored.payload_json)) === contentDigest(receipt) &&
      receipt.revision === 1 &&
      receipt.receiptHash === payloadHash(receipt, 'receiptHash') &&
      receipt.sourceIdentity === sourceIdentity(db, receipt.sessionId) &&
      receipt.profileIdentity === profileIdentity() &&
      receipt.cdfHash === contentDigest(cdf) &&
      validation.valid &&
      receipt.graphIdentity === validation.plan.graphIdentity &&
      receipt.targetIdentity === (target ? prerequisiteTargetIdentity(target) : null) &&
      receipt.snapshotHash === (snapshot?.snapshotHash ?? null),
    );
  } catch {
    return false;
  }
}

export function assertResolvedImportPrerequisites(
  plan: Readonly<ImportPrerequisitePlan>,
  snapshot?: SessionPrerequisiteSnapshot,
): void {
  for (const requirement of plan.capabilityRequirements)
    if (definitionImportCapabilityStatus(requirement.capability) === 'unavailable')
      throw new Error(`Required capability ${requirement.capability} remains unverified at ${requirement.path}`);
  for (const requirement of plan.obligations) {
    if (requirement.resolution === 'planned') continue;
    const mapping =
      snapshot && own(snapshot.referenceMappings, requirement.reference.value)
        ? snapshot.referenceMappings[requirement.reference.value]
        : undefined;
    if (!mapping || mapping.captureId !== snapshot?.captureId)
      throw new Error(`Token resource prerequisite needs an explicit target mapping at ${requirement.path}`);
    const token = snapshot!.tokens.find((token) => token.targetId === mapping.targetId);
    if (!token)
      throw new Error(
        `Token resource prerequisite remains ${snapshot!.coverage.DesignToken === 'complete' ? 'missing' : 'unknown'} at ${requirement.path}`,
      );
    if (token.kind !== requirement.expectedKind)
      throw new Error(`Token resource prerequisite kind differs at ${requirement.path}`);
  }
}
