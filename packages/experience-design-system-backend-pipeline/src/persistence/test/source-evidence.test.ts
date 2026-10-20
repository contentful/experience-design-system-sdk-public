import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { captureSourceEvidence } from '@contentful/experience-design-system-extraction';
import { buildCompilerEvidenceInline } from '../../agents/prompts/helpers/build-compiler-evidence-inline.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { RawComponentDefinition } from '../../steps/extraction/src/types/component.js';
import { runOneGenerateComponent } from '../../orchestrators/run-generate-components-session/helpers/run-one-generate-component.js';
import type { AgentInvoker } from '../../agents/types/invoker.js';
import {
  completeExtractionWithSourceEvidence,
  createStep,
  getOrCreateSession,
  loadCompletedSourceEvidence,
  loadComponentReviewMetadata,
  loadExtractionSourceDiagnostics,
  loadRawComponents,
  loadSavedComponentSourceRef,
  openPipelineDb,
  storeRawComponents,
} from '../src/session/repositories/db.js';

describe('saved extraction source evidence', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('commits one session-step envelope and serves frozen bytes to generation and review after reopen', async () => {
    dir = mkdtempSync(join(tmpdir(), 'saved-source-evidence-'));
    const sourcePath = join(dir, 'src', 'Card.ts');
    mkdirSync(join(dir, 'src'));
    writeFileSync(sourcePath, 'export const Card = () => "FROZEN_SOURCE_A";\n', 'utf8');
    const dbPath = join(dir, 'pipeline.db');
    const sourceText = 'export const Card = () => "FROZEN_SOURCE_A";\n';
    const sourceHash = createHash('sha256').update(sourceText).digest('hex');
    const location = {
      fileId: null,
      canonicalPath: sourcePath,
      textHash: sourceHash,
      startLine: 1,
      endLine: 1,
      binding: 'unverified' as const,
    };
    const candidate = {
      name: '__proto__',
      keyPath: ['__proto__'],
      evidenceKinds: ['declaration' as const],
      type: "'literal' | string",
      declaredRequired: true,
      sourceDefault: 'null',
      facts: {
        origin: 'own' as const,
        resolvedKind: 'union',
        certainty: 'certain' as const,
        ambiguityReason: null,
        declarations: [location],
        sourceTypeText: "'literal' | string",
        domain: { observedLiterals: [{ kind: 'string' as const, value: 'literal' }], openness: 'open' as const },
        declaredRequired: true,
        sourceDefault: { expression: 'null', location },
        advisoryShape: null,
        shapeNotes: [],
        requiredFieldDropped: null,
      },
      observations: [],
      projection: { kind: 'excluded' as const, reason: 'test-candidate-only' },
    };
    const extractionDiagnostics = {
      schemaVersion: 1 as const,
      projects: [
        {
          root: sourcePath,
          configPath: null,
          configHash: null,
          status: 'fallback' as const,
          options: {},
          diagnostics: ['test-config-warning'],
        },
      ],
      modules: [],
      references: [],
      coverage: 'partial' as const,
      limits: { maxRoots: 10 },
      used: { roots: 1 },
    };
    const component: RawComponentDefinition = {
      name: 'Card',
      source: sourcePath,
      sourcePath,
      framework: 'react',
      props: [{ name: 'label', type: 'string', required: false, sourceStartLine: 1, sourceEndLine: 1 }],
      slots: [],
      factSchemaVersion: 3,
      sourceCandidates: [candidate],
      sourceCandidateSources: [{ componentName: 'Card', sourcePath, factSchemaVersion: 3, candidates: [candidate] }],
    };

    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    const stepId = createStep(db, sessionId, 'analyze extract', { project: dir });
    storeRawComponents(db, sessionId, [component], { extractionDiagnostics });
    const storedComponent = loadRawComponents(db, sessionId)[0]!;
    const capture = await captureSourceEvidence({
      projectRoot: dir,
      filePaths: [sourcePath],
      components: [{ componentId: storedComponent.component_id, name: 'Card', sourcePath }],
    });
    const handle = completeExtractionWithSourceEvidence(db, {
      sessionId,
      stepId,
      components: [component],
      cycles: [],
      scannedFiles: [relative(dir, sourcePath)],
      capture,
      observations: { accepted: [{ component: 'Card', source: 'call-site' }], rejected: [] },
      extractionDiagnostics,
    });
    db.close();

    writeFileSync(sourcePath, 'export const Card = () => "CHANGED_SOURCE_B";\n', 'utf8');
    const reopened = openPipelineDb(dbPath);
    try {
      const saved = loadCompletedSourceEvidence(reopened, sessionId, handle);
      expect(saved.readiness).toBe('ready');
      if (saved.readiness !== 'ready') throw new Error('Expected a complete saved source envelope');
      expect(saved.handle).toEqual(handle);
      expect(saved.envelope.observations.accepted).toEqual([{ component: 'Card', source: 'call-site' }]);

      const savedComponent = loadRawComponents(reopened, sessionId)[0]!;
      expect(savedComponent.sourceEvidenceReadStatus).toBe('available');
      expect(savedComponent.factSchemaVersion).toBe(3);
      expect(savedComponent.sourceCandidates?.[0]?.keyPath).toEqual(['__proto__']);
      expect(savedComponent.sourceCandidates?.[0]?.facts?.declarations[0]?.binding).toBe('verified');
      expect(savedComponent.sourceCandidateSources?.[0]?.candidates?.[0]?.name).toBe('__proto__');
      expect(loadExtractionSourceDiagnostics(reopened, sessionId)).toEqual({
        status: 'available',
        diagnostics: extractionDiagnostics,
      });

      const sourceRef = loadSavedComponentSourceRef(
        reopened,
        sessionId,
        storedComponent.component_id,
        'Card',
        sourcePath,
        ['label'],
        ['string'],
      );
      expect(sourceRef.content).toContain('FROZEN_SOURCE_A');
      expect(sourceRef.content).not.toContain('CHANGED_SOURCE_B');
      expect(sourceRef.sourceEvidence).toMatchObject({
        captureId: capture.captureId,
        captureDigest: saved.envelope.digest,
        extractionByteBinding: 'unverified',
      });

      const review = loadComponentReviewMetadata(reopened, sessionId, 'Card');
      expect(review?.componentSource).toContain('FROZEN_SOURCE_A');
      expect(review?.componentSource).not.toContain('CHANGED_SOURCE_B');
      expect(review?.sourceCoverage).toBe(capture.coverage);
      expect(review?.extractionByteBinding).toBe('unverified');
      expect(review?.sourceLineRanges).toEqual([{ sourceStartLine: 1, sourceEndLine: 2, displayStartLine: 1 }]);
      expect(review?.sourceEvidenceReadStatus).toBe('available');
      expect(review?.props['__proto__']).toBeUndefined();
      expect(review?.sourceCandidates?.[0]?.keyPath).toEqual(['__proto__']);

      const prompts: string[] = [];
      const invoker: AgentInvoker = {
        checkAuth: async () => 'ok',
        invoke: async ({ prompt }) => {
          prompts.push(prompt);
          return {
            stdout: JSON.stringify({
              tool: 'classify_prop',
              prop: 'label',
              cdf_type: 'string',
              cdf_category: 'content',
            }),
            stderr: '',
            exitCode: 0,
            timedOut: false,
          };
        },
      };
      for (const diskState of ['changed', 'deleted']) {
        if (diskState === 'deleted') rmSync(sourcePath);
        const generated = await runOneGenerateComponent(
          {
            db: reopened,
            sessionId,
            invoker,
            agent: 'claude',
            model: undefined,
            tokensInline: undefined,
            tokenMapInline: undefined,
            verbose: false,
            noCache: true,
            skillPathOverride: undefined,
            skillContentOverride: 'Generate from the supplied source evidence.',
            promptHash: 'generic-test-prompt',
            existingContentfulEntities: undefined,
            existingTokensInline: undefined,
            compilerEvidenceInline: buildCompilerEvidenceInline([savedComponent], {
              readiness: 'ready',
              diagnostics: extractionDiagnostics,
              diagnosticsStatus: 'available',
            }),
            precomputedCachedNames: new Set(),
            allowedComponentNames: new Set(['Card']),
            onProgress: undefined,
          },
          savedComponent,
          0,
          1,
        );
        expect(generated.failed).toBe(false);
        expect(prompts.at(-1)).toContain('FROZEN_SOURCE_A');
        expect(prompts.at(-1)).not.toContain('CHANGED_SOURCE_B');
        expect(prompts.at(-1)).toContain(capture.captureId);
        expect(prompts.at(-1)).toContain(capture.files[0]!.textHash!);
        expect(prompts.at(-1)).toContain('Compiler evidence and source candidates');
        expect(prompts.at(-1)).toContain('"keyPath":["__proto__"]');
        expect(prompts.at(-1)).toContain('"test-config-warning"');
      }
      expect(prompts).toHaveLength(2);
    } finally {
      reopened.close();
    }
  });

  it.each(['[null]', '[{}]', '[{"name":"label","facts":{}}]'])(
    'reports malformed saved candidate members as corrupt without breaking review: %s',
    (payload) => {
      dir = mkdtempSync(join(tmpdir(), 'saved-candidate-corrupt-'));
      const db = openPipelineDb(join(dir, 'pipeline.db'));
      try {
        const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
        storeRawComponents(db, sessionId, [
          {
            name: 'Card',
            source: 'Card.tsx',
            framework: 'react',
            props: [],
            slots: [],
            factSchemaVersion: 3,
            sourceCandidates: [],
          },
        ]);
        db.prepare('UPDATE raw_component_source_evidence SET candidates_json = ? WHERE session_id = ?').run(
          payload,
          sessionId,
        );
        expect(loadRawComponents(db, sessionId)[0]?.sourceEvidenceReadStatus).toBe('corrupt');
        expect(loadComponentReviewMetadata(db, sessionId, 'Card')?.sourceCandidates).toBeNull();
      } finally {
        db.close();
      }
    },
  );

  it('reports malformed run diagnostic members as corrupt', () => {
    dir = mkdtempSync(join(tmpdir(), 'saved-diagnostic-corrupt-'));
    const db = openPipelineDb(join(dir, 'pipeline.db'));
    try {
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      db.prepare('INSERT INTO extraction_source_diagnostics (session_id, payload_json) VALUES (?, ?)').run(
        sessionId,
        JSON.stringify({ schemaVersion: 1, projects: [null], modules: [] }),
      );
      expect(loadExtractionSourceDiagnostics(db, sessionId)).toEqual({ status: 'corrupt' });
    } finally {
      db.close();
    }
  });

  it('rolls back component, scan, envelope, and readiness writes when envelope persistence fails', async () => {
    dir = mkdtempSync(join(tmpdir(), 'saved-source-rollback-'));
    const sourcePath = join(dir, 'Card.ts');
    writeFileSync(sourcePath, 'export const Card = () => null;\n', 'utf8');
    const db = openPipelineDb(join(dir, 'pipeline.db'));
    try {
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      const stepId = createStep(db, sessionId, 'analyze extract', { project: dir });
      const component: RawComponentDefinition = {
        name: 'Card',
        source: sourcePath,
        sourcePath,
        framework: 'react',
        props: [],
        slots: [],
      };
      storeRawComponents(db, sessionId, [component]);
      const capture = await captureSourceEvidence({ projectRoot: dir, filePaths: [sourcePath] });
      db.exec(`CREATE TRIGGER fail_source_envelope BEFORE INSERT ON session_source_envelopes
        BEGIN SELECT RAISE(ABORT, 'source envelope write failed'); END`);

      expect(() =>
        completeExtractionWithSourceEvidence(db, {
          sessionId,
          stepId,
          components: [component],
          cycles: [],
          scannedFiles: ['Card.ts'],
          capture,
          observations: { accepted: [], rejected: [] },
        }),
      ).toThrow('source envelope write failed');
      expect(db.prepare('SELECT status FROM steps WHERE id = ?').get(stepId)).toEqual({ status: 'pending' });
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM session_source_envelopes WHERE session_id = ?').get(sessionId),
      ).toEqual({
        count: 0,
      });
      expect(db.prepare('SELECT path FROM scanned_files WHERE session_id = ?').all(sessionId)).toEqual([]);
      expect(loadRawComponents(db, sessionId).map((row) => row.name)).toEqual(['Card']);
      expect(loadCompletedSourceEvidence(db, sessionId).readiness).toBe('unavailable');
    } finally {
      db.close();
    }
  });

  it('does not publish extraction readiness from another command step', async () => {
    dir = mkdtempSync(join(tmpdir(), 'saved-source-wrong-command-'));
    const sourcePath = join(dir, 'Card.ts');
    writeFileSync(sourcePath, 'export const Card = () => null;\n', 'utf8');
    const db = openPipelineDb(join(dir, 'pipeline.db'));
    try {
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      const stepId = createStep(db, sessionId, 'generate components', {});
      const capture = await captureSourceEvidence({ projectRoot: dir, filePaths: [sourcePath] });
      expect(() =>
        completeExtractionWithSourceEvidence(db, {
          sessionId,
          stepId,
          components: [],
          cycles: [],
          scannedFiles: ['Card.ts'],
          capture,
          observations: { accepted: [], rejected: [] },
        }),
      ).toThrow(/extraction step/i);
      expect(db.prepare('SELECT status FROM steps WHERE id = ?').get(stepId)).toEqual({ status: 'pending' });
      expect(db.prepare('SELECT COUNT(*) AS n FROM session_source_envelopes').get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it('fails closed for mismatched handles and corrupt saved payloads', async () => {
    dir = mkdtempSync(join(tmpdir(), 'saved-source-corrupt-'));
    const sourcePath = join(dir, 'Card.ts');
    writeFileSync(sourcePath, 'export const Card = () => null;\n', 'utf8');
    const dbPath = join(dir, 'pipeline.db');
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    const stepId = createStep(db, sessionId, 'analyze extract', { project: dir });
    const component: RawComponentDefinition = {
      name: 'Card',
      source: sourcePath,
      sourcePath,
      framework: 'react',
      props: [],
      slots: [],
    };
    storeRawComponents(db, sessionId, [component]);
    const capture = await captureSourceEvidence({ projectRoot: dir, filePaths: [sourcePath] });
    const handle = completeExtractionWithSourceEvidence(db, {
      sessionId,
      stepId,
      components: [component],
      cycles: [],
      scannedFiles: ['Card.ts'],
      capture,
      observations: { accepted: [], rejected: [] },
    });
    try {
      expect(loadCompletedSourceEvidence(db, 'unrelated-session', handle)).toMatchObject({
        readiness: 'unavailable',
        reason: 'completed-extraction-step-unavailable',
      });
      expect(loadCompletedSourceEvidence(db, sessionId, { ...handle, extractionStepId: stepId + 1 })).toMatchObject({
        readiness: 'unavailable',
        reason: 'completed-extraction-step-unavailable',
      });
      expect(loadCompletedSourceEvidence(db, sessionId, { ...handle, digest: 'wrong-digest' })).toMatchObject({
        readiness: 'unavailable',
        reason: 'completed-step-source-identity-mismatch',
      });
      const originalPayload = db
        .prepare('SELECT payload_json FROM session_source_envelopes WHERE envelope_id = ?')
        .get(handle.envelopeId) as { payload_json: string };
      expect(() =>
        db
          .prepare('UPDATE session_source_envelopes SET payload_json = ? WHERE envelope_id = ?')
          .run('{"schemaVersion":1}', handle.envelopeId),
      ).toThrow(/immutable/i);
      db.exec('DROP TRIGGER session_source_envelopes_immutable');
      db.prepare('UPDATE session_source_envelopes SET payload_json = ? WHERE envelope_id = ?').run(
        '{"schemaVersion":1}',
        handle.envelopeId,
      );
      expect(loadCompletedSourceEvidence(db, sessionId, handle)).toMatchObject({
        readiness: 'unavailable',
        reason: 'saved-source-envelope-corrupt',
      });
      db.prepare('UPDATE session_source_envelopes SET payload_json = ? WHERE envelope_id = ?').run(
        originalPayload.payload_json,
        handle.envelopeId,
      );
      db.prepare('DELETE FROM session_source_envelopes WHERE envelope_id = ?').run(handle.envelopeId);
      expect(loadCompletedSourceEvidence(db, sessionId, handle)).toMatchObject({
        readiness: 'unavailable',
        reason: 'saved-source-envelope-unavailable',
      });
    } finally {
      db.close();
    }
  });
});
