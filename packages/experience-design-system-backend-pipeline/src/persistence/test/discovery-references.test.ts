import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  captureSourceEvidence,
  extractReactComponents as extractPublic,
  extractComponents as extractPublicRegistry,
} from '../../steps/extraction/index.js';
import { extractReactComponents } from '../../steps/extraction/src/framework-adapters/react/extract-react-components.js';
import { readComponentFacts } from '../src/session/repositories/component-facts-validation.js';
import { buildSelectionEvidenceInline } from '../../agents/prompts/helpers/build-selection-evidence-inline.js';
import {
  buildSharedSource,
  projectSharedSource,
  projectExplorationSource,
} from '../../source-evidence/shared-source.js';
import { bindSavedSourceReferences } from '../src/session/repositories/source-reference-binding.js';
import * as api from '../../index.js';
import { collectSourceCallSiteEvidence } from '../../steps/composition/src/helpers/edges/source-call-site-evidence.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
it('delivers actual default incoming reference and inventory evidence through completion, reopening and saved consumers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'saved-source-references-'));
  roots.push(root);
  const selected = join(root, 'Surface.tsx');
  const caller = join(root, 'Caller.test.tsx');
  writeFileSync(selected, `export function Surface(props:{label:string}){return <section>{props.label}</section>}`);
  writeFileSync(caller, `import {Surface as Alias} from '@surface';const nested=()=>()=> <Alias label="sample"/>;`);
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { jsx: 'preserve', baseUrl: '.', paths: { '@surface': ['./Surface'] } } }),
  );
  const options = { projectRoot: root, evidenceFilePaths: [caller] };
  const library = await extractPublic([selected], undefined, options);
  const publicRegistered = await extractPublicRegistry([selected], undefined, options);
  const backend = await extractReactComponents([selected], undefined, options);
  const index = backend.components[0]!.componentFacts!.sourceObservations!.referenceIndex;
  expect(index).toBeDefined();
  expect(publicRegistered.components[0]!.componentFacts!.sourceObservations!.referenceIndex).toEqual(index);
  expect(index).toEqual(library.components[0]!.componentFacts!.sourceObservations!.referenceIndex);
  expect(readComponentFacts(backend.components[0]!.componentFacts).status).toBe('available');
  const registered = await api.extractComponents({ filePaths: [selected], projectRoot: root, opts: options });
  expect(registered.components[0]!.componentFacts!.sourceObservations!.referenceIndex).toEqual(index);
  const callers = collectSourceCallSiteEvidence(
    [
      {
        path: caller,
        content: `import {Surface as Alias} from '@surface';const nested=()=>()=> <Alias label="sample"/>;`,
      },
      {
        path: selected,
        content: `export function Surface(props:{label:string}){return <section>{props.label}</section>}`,
      },
    ],
    backend.components,
  );
  expect(callers.coverage.analysis).toBe('configured-lexical-references');
  expect(callers.accepted[0]?.lexicalAncestors).toHaveLength(2);
  const stale = collectSourceCallSiteEvidence(
    [
      { path: caller, content: 'changed' },
      { path: selected, content: 'changed' },
    ],
    backend.components,
  );
  expect(stale.accepted).toEqual([]);
  expect(stale.rejected[0]?.reason).toBe('unbound-component');
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [selected],
    evidenceFilePaths: [caller],
    compilerSources: backend.compilerSources,
    inventory: backend.sourceInventory,
  });
  expect(capture.inventory).toBeDefined();
  expect(capture.files.some((file) => file.canonicalPath === realpathSync(caller))).toBe(true);
  const dbPath = join(root, 'pipeline.db');
  let db = api.openPipelineDb(dbPath);
  const { sessionId } = api.getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  const stepId = api.createStep(db, sessionId, 'analyze extract', {});
  const handle = api.completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId,
    components: backend.components,
    cycles: [],
    scannedFiles: [selected],
    capture,
    observations: {
      accepted: [],
      rejected: [],
      callerCoverage: {
        scope: 'admitted-source',
        analysis: 'lexical-jsx-in-known-component-bodies',
        coverage: 'partial',
        files: [],
        unresolvedReferences: 0,
        unownedReferences: 1,
        components: [],
      },
    },
  });
  db.close();
  rmSync(caller);
  db = api.openPipelineDb(dbPath);
  const saved = api.loadRawComponents(db, sessionId)[0]!;
  const completed = api.loadCompletedSourceEvidence(db, sessionId, handle);
  expect(completed.readiness).toBe('ready');
  expect(
    saved.componentFacts!.sourceObservations!.referenceIndex!.references.find((ref) => ref.kind === 'jsx')?.location
      .binding,
  ).toBe('verified');
  if (completed.readiness !== 'ready') throw new Error('missing completed source');
  const selection = buildSelectionEvidenceInline(completed.envelope);
  expect(selection).toContain('callerCoverage');
  expect(selection).toContain('referenceIndexes');
  expect(selection).toContain('inventory');
  const shared = buildSharedSource(completed.envelope, [saved.component_id]);
  expect(shared.files.some((file) => file.canonicalPath === realpathSync(root) + '/Caller.test.tsx')).toBe(true);
  expect(shared.observations?.referenceIndexes).toHaveLength(1);
  db.close();
});

it('discloses changed, missing and invalid saved reference endpoints beside preserved declared inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bound-reference-controls-'));
  roots.push(root);
  const path = join(root, 'Surface.tsx');
  writeFileSync(
    path,
    `export function Surface(props:{label:string}){return <section>{props.label}</section>}const a=<Surface label="sample"/>;`,
  );
  const result = await extractReactComponents([path], undefined, { projectRoot: root });
  const index = result.components[0]!.componentFacts!.sourceObservations!.referenceIndex!;
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [path],
    compilerSources: result.compilerSources,
    inventory: result.sourceInventory,
  });
  expect(bindSavedSourceReferences(index, capture.files).declaration.binding).toBe('verified');
  const changed = structuredClone(capture.files);
  changed[0]!.textHash = '0'.repeat(64);
  const bound = bindSavedSourceReferences(index, changed);
  expect(bound.declaration.binding).toBe('changed');
  expect(bound.coverage).toBe('partial');
  expect(bound.summaries[0]?.reasons).toContain('saved-reference-binding-unavailable');
  expect(bindSavedSourceReferences(index, []).declaration.binding).toBe('unavailable');
  const invalid = structuredClone(index);
  invalid.declaration.endOffset = 99999;
  expect(bindSavedSourceReferences(invalid, capture.files).declaration.binding).toBe('unavailable');
});
it('atomically rolls back actual versioned discovery/reference completion and fails closed for wrong completed identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atomic-reference-controls-'));
  roots.push(root);
  const path = join(root, 'Surface.tsx');
  writeFileSync(
    path,
    `export function Surface(props:{label:string}){return <b>{props.label}</b>}const a=<Surface label="sample"/>;`,
  );
  const result = await extractReactComponents([path], undefined, { projectRoot: root });
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [path],
    compilerSources: result.compilerSources,
    inventory: result.sourceInventory,
  });
  const db = api.openPipelineDb(join(root, 'pipeline.db'));
  try {
    const { sessionId } = api.getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    const stepId = api.createStep(db, sessionId, 'analyze extract', {});
    const input = {
      sessionId,
      stepId,
      components: result.components,
      cycles: [],
      scannedFiles: [path],
      capture,
      observations: { accepted: [], rejected: [] },
    };
    db.exec(
      `CREATE TRIGGER fail_source_envelope BEFORE INSERT ON session_source_envelopes BEGIN SELECT RAISE(ABORT,'write failed'); END`,
    );
    expect(() => api.completeExtractionWithSourceEvidence(db, input)).toThrow('write failed');
    expect(db.prepare('SELECT status FROM steps WHERE id=?').get(stepId)).toEqual({ status: 'pending' });
    expect(api.loadRawComponents(db, sessionId)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM session_source_envelopes').get()).toEqual({ count: 0 });
    db.exec('DROP TRIGGER fail_source_envelope');
    const handle = api.completeExtractionWithSourceEvidence(db, input);
    expect(api.loadCompletedSourceEvidence(db, sessionId, { ...handle, digest: 'wrong' }).readiness).not.toBe('ready');
    const completed = api.loadCompletedSourceEvidence(db, sessionId, handle);
    expect(completed.readiness).toBe('ready');
    if (completed.readiness !== 'ready') throw new Error('missing completed state');
    expect(completed.envelope.observations.referenceIndexes).toHaveLength(1);
    const limited = structuredClone(completed.envelope);
    limited.capture.bounds.limits.maxPromptBytes = 2200;
    const selection = JSON.parse(buildSelectionEvidenceInline(limited));
    expect(selection.promptCoverage).toBe(limited.capture.coverage);
    expect(selection.referenceIndexesOmitted).toBe(0);
    expect(selection.observations.referenceIndexes).toEqual(limited.observations.referenceIndexes);
    expect(
      selection.files?.some((file: { captured: { text?: string } }) =>
        file.captured.text?.includes('export function Surface'),
      ),
    ).toBe(true);

    const shared = projectSharedSource(buildSharedSource(completed.envelope));
    expect(shared.promptCoverage).toBe(completed.envelope.capture.coverage);
    expect(shared.observations).toEqual(completed.envelope.observations);
    expect(shared.inventory).toBeDefined();
    expect(shared.omittedObservations ?? 0).toBe(0);
    expect(shared.omittedInventory ?? 0).toBe(0);
    const explored = projectExplorationSource(completed.envelope);
    expect(explored.promptCoverage).toBe(completed.envelope.capture.coverage);
    expect(explored.observations).toEqual(completed.envelope.observations);
    expect(explored.files).toHaveLength(completed.envelope.capture.files.length);
    expect(explored.omittedObservations ?? 0).toBe(0);
  } finally {
    db.close();
  }
});
