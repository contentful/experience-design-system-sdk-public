import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { extractReactComponents, captureSourceEvidence } from '@contentful/experience-design-system-extraction';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  storeRawComponents,
  loadRawComponents,
  applyScopeDecisions,
  completeExtractionWithSourceEvidence,
  loadCompletedSourceEvidence,
} from '../src/session/repositories/db.js';
import { writeScopeDecisionsSnapshot } from '../src/review-session/services/write-scope-decisions-snapshot.js';
import { getRefineSessionPaths } from '../src/review-session/repositories/review-session-paths.js';
import { buildCompilerEvidenceInline } from '../../agents/prompts/helpers/build-compiler-evidence-inline.js';
import { runOneGenerateComponent } from '../../orchestrators/run-generate-components-session/helpers/run-one-generate-component.js';

it('retains real default source observations through initial/final/cold/review saves and actual saved generation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'saved-source-observations-'));
  const path = join(root, 'Panel.tsx');
  const dbPath = join(root, 'pipeline.db');
  const oldReviews = process.env.EDS_REVIEW_ARTIFACTS_DIR;
  process.env.EDS_REVIEW_ARTIFACTS_DIR = join(root, 'reviews');
  writeFileSync(
    path,
    `declare function readValue(value:string):string; type Props = { label:string }; export function Panel(props:Props) { return <div>{readValue(props.label)}</div>; }`,
  );
  try {
    const component = (await extractReactComponents([path], undefined, { projectRoot: root })).components[0]!;
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    storeRawComponents(db, sessionId, [component]);
    const first = loadRawComponents(db, sessionId)[0]!;
    expect(
      first.componentFacts?.sourceObservations?.observations.some((observation) => observation.kind === 'call'),
    ).toBe(true);
    expect(first.componentEvidenceReadStatus).toBe('available');
    const capture = await captureSourceEvidence({
      projectRoot: root,
      filePaths: [path],
      components: [{ componentId: first.component_id, name: 'Panel', sourcePath: path }],
    });
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
    try {
      const saved = loadRawComponents(reopened, sessionId)[0]!;
      const collection = saved.componentFacts!.sourceObservations!;
      const call = collection.observations.find((observation) => observation.kind === 'call')!;
      expect(call.location.binding).toBe('verified');
      expect(call.context.lexicalDeclaration?.binding).toBe('verified');
      expect(call.operands?.[0]?.location.binding).toBe('verified');
      expect(call.subject?.declarations?.[0]?.location.binding).toBe('verified');
      expect(JSON.parse(JSON.stringify(collection))).toEqual(collection);
      applyScopeDecisions(reopened, sessionId, { accepted: ['Panel'], rejected: [] });
      await writeScopeDecisionsSnapshot(reopened, sessionId);
      const paths = await getRefineSessionPaths(sessionId, process.env.EDS_REVIEW_ARTIFACTS_DIR);
      const review = JSON.parse(readFileSync(paths.statePath, 'utf8'));
      expect(review.components[0].editedProposal.componentFacts).toEqual(saved.componentFacts);
      storeRawComponents(reopened, sessionId, [review.components[0].editedProposal], { preserveStatus: true });
      expect(loadRawComponents(reopened, sessionId)[0]?.componentFacts).toEqual(saved.componentFacts);
      const prompts: string[] = [];
      const result = await runOneGenerateComponent(
        {
          db: reopened,
          sessionId,
          invoker: {
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
          },
          agent: 'claude',
          model: undefined,
          tokensInline: undefined,
          tokenMapInline: undefined,
          verbose: false,
          noCache: true,
          skillPathOverride: undefined,
          skillContentOverride: 'Generate from saved source.',
          promptHash: 'example-prompt',
          existingContentfulEntities: undefined,
          existingTokensInline: undefined,
          compilerEvidenceInline: buildCompilerEvidenceInline([saved], { readiness: 'ready' }),
          precomputedCachedNames: new Set(),
          allowedComponentNames: new Set(['Panel']),
          onProgress: undefined,
        },
        saved,
        0,
        1,
      );
      expect(result.failed).toBe(false);
      const raw = prompts[0]!.match(/Raw component data \(JSON\):\n```json\n([\s\S]*?)\n```/)![1]!;
      expect(raw).not.toContain('sourceObservations');
      expect(prompts[0]).toContain('readValue(props.label)');
      expect(prompts[0]).not.toContain('changed');
      const channel = prompts[0]!.match(/Compiler evidence and source candidates[^\n]*\n```json\n([\s\S]*?)\n```/)![1]!;
      expect(JSON.parse(channel).componentFacts[0].facts.sourceObservations).toEqual(collection);
      for (const payload of [
        '{"schemaVersion":2,"sourceObservations":{}}',
        '{"schemaVersion":999,"sourceObservations":{}}',
        '{"schemaVersion":2,"sourceObservations":{"schemaVersion":999}}',
      ]) {
        const unavailable = { ...component, componentFacts: JSON.parse(payload) };
        completeExtractionWithSourceEvidence(reopened, {
          sessionId,
          stepId: createStep(reopened, sessionId, 'analyze extract', {}),
          components: [unavailable],
          cycles: [],
          scannedFiles: ['Panel.tsx'],
          capture,
          observations: { accepted: [], rejected: [] },
        });
        const loaded = loadRawComponents(reopened, sessionId)[0]!;
        expect(loaded.componentFacts).toBeUndefined();
        expect(loaded.componentEvidenceReadStatus).toBe(payload.includes('999') ? 'unsupported' : 'corrupt');
        expect(loaded.sourceCandidates).toEqual(saved.sourceCandidates);
        expect(loadCompletedSourceEvidence(reopened, sessionId).readiness).toBe('ready');
      }
      expect(loadCompletedSourceEvidence(reopened, sessionId, handle).readiness).toBe('ready');
      expect(loadCompletedSourceEvidence(reopened, sessionId, { ...handle, digest: 'changed' }).readiness).toBe(
        'unavailable',
      );
    } finally {
      reopened.close();
    }
  } finally {
    if (oldReviews === undefined) delete process.env.EDS_REVIEW_ARTIFACTS_DIR;
    else process.env.EDS_REVIEW_ARTIFACTS_DIR = oldReviews;
    rmSync(root, { recursive: true, force: true });
  }
});
