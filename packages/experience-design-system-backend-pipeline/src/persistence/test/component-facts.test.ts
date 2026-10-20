import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureSourceEvidence, type ComponentFacts } from '@contentful/experience-design-system-extraction';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  storeRawComponents,
  applyScopeDecisions,
  loadRawComponents,
  completeExtractionWithSourceEvidence,
  loadCompletedSourceEvidence,
  loadComponentReviewMetadata,
} from '../src/session/repositories/db.js';
import { writeScopeDecisionsSnapshot } from '../src/review-session/services/write-scope-decisions-snapshot.js';
import { getRefineSessionPaths } from '../src/review-session/repositories/review-session-paths.js';
import type { RawComponentDefinition } from '../../steps/extraction/src/types/component.js';

let directory: string;
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});
const candidate = {
  name: 'label',
  keyPath: ['label'],
  evidenceKinds: ['declaration' as const],
  type: "'short' | 'long'",
  declaredRequired: true,
  sourceDefault: "'short'",
  facts: null,
  observations: [],
  projection: { kind: 'prop' as const, reason: null },
};
function fixture() {
  directory = mkdtempSync(join(tmpdir(), 'saved-component-facts-'));
  const path = join(directory, 'Panel.tsx');
  const text = 'export const Panel = () => null;';
  writeFileSync(path, text);
  const location = {
    fileId: null,
    canonicalPath: path,
    textHash: createHash('sha256').update(text).digest('hex'),
    startLine: 1,
    endLine: 1,
    startOffset: 0,
    endOffset: text.length,
    binding: 'unverified' as const,
  };
  const facts: ComponentFacts = {
    schemaVersion: 1,
    members: [{ name: 'Item', exportName: 'Item', certainty: 'certain', location }],
    childFilters: [{ slot: 'content', kind: 'type-check', allowed: ['Item'], certainty: 'ambiguous', location }],
    requiresParent: [{ parent: 'Parent', reason: 'context-missing', certainty: 'unknown', location }],
    origin: { kind: 'in-repository', certainty: 'certain', realPath: path, location },
    renderables: [
      {
        name: 'content',
        delivery: 'node-prop',
        elementTyped: null,
        typeName: 'Element',
        sourceTypeText: 'string | Element',
        origin: 'unknown',
        certainty: 'unknown',
        location,
      },
    ],
    nonStatic: [
      {
        kind: 'external-call',
        name: 'readValue',
        declaredIn: 'example.ts',
        packageName: 'example-package',
        certainty: 'ambiguous',
        location,
      },
    ],
    referencedOrigins: [
      {
        name: 'Item',
        symbolName: 'Item',
        certainty: 'unknown',
        location,
        origin: { kind: 'unresolved', certainty: 'unknown', location },
      },
    ],
  };
  const component: RawComponentDefinition = {
    name: 'Panel',
    source: path,
    sourcePath: path,
    framework: 'react',
    props: [
      {
        name: 'label',
        type: "'short' | 'long'",
        required: false,
        defaultValue: 'short',
        allowedValues: ['short', 'long'],
      },
    ],
    slots: [],
    factSchemaVersion: 4,
    sourceCandidates: [candidate],
    componentFacts: facts,
  };
  return { path, facts, component, dbPath: join(directory, 'pipeline.db') };
}

describe('saved component facts', () => {
  it('retains component-only evidence without requiring a prop candidate schema', () => {
    const { component, facts, dbPath } = fixture();
    const db = openPipelineDb(dbPath);
    try {
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      const { sourceCandidates: _candidates, factSchemaVersion: _schema, ...independent } = component;
      storeRawComponents(db, sessionId, [independent]);
      const saved = loadRawComponents(db, sessionId)[0]!;
      expect(saved.componentEvidenceReadStatus).toBe('available');
      expect(saved.componentFacts).toEqual(facts);
      expect(saved.sourceEvidenceReadStatus).toBe('unknown-legacy');
      expect(saved.sourceCandidates).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('treats nonplain or cyclic supplied component data as corrupt while conserving candidates', () => {
    const { component, dbPath } = fixture();
    const db = openPipelineDb(dbPath);
    try {
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      const cyclic: Record<string, unknown> = { schemaVersion: 1 };
      cyclic.compilerNode = cyclic;
      for (const payload of [cyclic, { schemaVersion: 1, compilerNode: new Date() }]) {
        storeRawComponents(db, sessionId, [{ ...component, componentFacts: payload as never }]);
        const saved = loadRawComponents(db, sessionId)[0]!;
        expect(saved.componentEvidenceReadStatus).toBe('corrupt');
        expect(saved.componentFacts).toBeUndefined();
        expect(saved.sourceCandidates).toEqual([candidate]);
      }
    } finally {
      db.close();
    }
  });

  it.each([
    [{ schemaVersion: 1, renderables: {} }, 'corrupt'],
    [{ schemaVersion: 1, members: [null] }, 'corrupt'],
    [{ schemaVersion: 99, renderables: {} }, 'unsupported'],
  ] as const)(
    'completes capture with unavailable component facts %j without losing valid candidates',
    async (payload, status) => {
      const { path, component, dbPath } = fixture();
      const db = openPipelineDb(dbPath);
      try {
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
        const supplied = { ...component, componentFacts: payload as never };
        storeRawComponents(db, sessionId, [supplied]);
        const capture = await captureSourceEvidence({ projectRoot: directory, filePaths: [path] });
        const handle = completeExtractionWithSourceEvidence(db, {
          sessionId,
          stepId: createStep(db, sessionId, 'analyze extract', {}),
          components: [supplied],
          cycles: [],
          scannedFiles: ['Panel.tsx'],
          capture,
          observations: { accepted: [], rejected: [] },
        });
        const saved = loadRawComponents(db, sessionId)[0]!;
        expect(saved.componentEvidenceReadStatus).toBe(status);
        expect(saved.componentFacts).toBeUndefined();
        expect(saved.sourceEvidenceReadStatus).toBe('available');
        expect(saved.sourceCandidates).toEqual([candidate]);
        expect(loadCompletedSourceEvidence(db, sessionId, handle).readiness).toBe('ready');
      } finally {
        db.close();
      }
    },
  );

  it('retains initial/final saves, cold loading and exact review replacement independently from immutable envelope scope', async () => {
    const { path, facts, component, dbPath } = fixture();
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    storeRawComponents(db, sessionId, [component]);
    expect(loadRawComponents(db, sessionId)[0]?.componentFacts).toEqual(facts);
    const capture = await captureSourceEvidence({ projectRoot: directory, filePaths: [path] });
    const handle = completeExtractionWithSourceEvidence(db, {
      sessionId,
      stepId: createStep(db, sessionId, 'analyze extract', {}),
      components: [component],
      cycles: [],
      scannedFiles: ['Panel.tsx'],
      capture,
      observations: { accepted: [], rejected: [] },
    });
    db.close();
    writeFileSync(path, 'changed');
    const reopened = openPipelineDb(dbPath);
    const previousRoot = process.env.EDS_REVIEW_ARTIFACTS_DIR;
    process.env.EDS_REVIEW_ARTIFACTS_DIR = join(directory, 'reviews');
    try {
      const saved = loadRawComponents(reopened, sessionId)[0]!;
      expect(saved.componentEvidenceReadStatus).toBe('available');
      expect(saved.componentFacts?.renderables?.[0]?.location?.binding).toBe('verified');
      expect(saved.componentFacts?.referencedOrigins?.[0]?.origin.location?.binding).toBe('verified');
      expect(saved.sourceCandidates).toEqual([candidate]);
      expect(saved.props).toEqual(component.props);
      expect(loadComponentReviewMetadata(reopened, sessionId, 'Panel')?.componentFacts).toEqual(saved.componentFacts);
      applyScopeDecisions(reopened, sessionId, { accepted: ['Panel'], rejected: [] });
      await writeScopeDecisionsSnapshot(reopened, sessionId);
      const paths = await getRefineSessionPaths(sessionId, process.env.EDS_REVIEW_ARTIFACTS_DIR);
      const review = JSON.parse(readFileSync(paths.statePath, 'utf8'));
      expect(review.components[0].editedProposal.componentFacts).toEqual(saved.componentFacts);
      expect(review.components[0].originalProposal.componentFacts).toEqual(saved.componentFacts);
      storeRawComponents(reopened, sessionId, [review.components[0].editedProposal], { preserveStatus: true });
      expect(loadRawComponents(reopened, sessionId)[0]?.componentFacts).toEqual(saved.componentFacts);
      reopened
        .prepare('UPDATE raw_component_source_evidence SET component_facts_json = ? WHERE session_id = ?')
        .run('null', sessionId);
      expect(loadRawComponents(reopened, sessionId)[0]?.componentEvidenceReadStatus).toBe('corrupt');
      expect(loadCompletedSourceEvidence(reopened, sessionId, handle).readiness).toBe('ready');
    } finally {
      reopened.close();
      if (previousRoot === undefined) delete process.env.EDS_REVIEW_ARTIFACTS_DIR;
      else process.env.EDS_REVIEW_ARTIFACTS_DIR = previousRoot;
    }
  });

  it.each([
    [null, 'unknown-legacy'],
    ['{', 'corrupt'],
    ['[]', 'corrupt'],
    ['null', 'corrupt'],
    ['{"schemaVersion":99}', 'unsupported'],
    ['{"schemaVersion":1,"renderables":[{}]}', 'corrupt'],
    ['{"schemaVersion":1,"compilerNode":{}}', 'corrupt'],
  ])('keeps valid candidates when component payload %s is %s', (payload, status) => {
    const { component, dbPath } = fixture();
    const db = openPipelineDb(dbPath);
    try {
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [component]);
      db.prepare('UPDATE raw_component_source_evidence SET component_facts_json = ? WHERE session_id = ?').run(
        payload,
        sessionId,
      );
      const saved = loadRawComponents(db, sessionId)[0]!;
      expect(saved.componentEvidenceReadStatus).toBe(status);
      expect(saved.componentFacts).toBeUndefined();
      expect(saved.sourceEvidenceReadStatus).toBe('available');
      expect(saved.sourceCandidates).toEqual([candidate]);
    } finally {
      db.close();
    }
  });

  it('migrates an old nullable sidecar idempotently and conserves old candidates', () => {
    const { component, dbPath } = fixture();
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    storeRawComponents(db, sessionId, [{ ...component, componentFacts: undefined }]);
    db.exec('ALTER TABLE raw_component_source_evidence DROP COLUMN component_facts_json');
    db.close();
    for (let index = 0; index < 2; index++) {
      const reopened = openPipelineDb(dbPath);
      try {
        const saved = loadRawComponents(reopened, sessionId)[0]!;
        expect(saved.componentEvidenceReadStatus).toBe('unknown-legacy');
        expect(saved.sourceCandidates).toEqual([candidate]);
      } finally {
        reopened.close();
      }
    }
  });
});
