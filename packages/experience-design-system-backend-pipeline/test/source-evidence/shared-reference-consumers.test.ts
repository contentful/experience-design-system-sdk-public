import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureSourceEvidence, extractReactComponents } from '../../src/steps/extraction/index.js';
import {
  completeExtractionWithSourceEvidence,
  createStep,
  getOrCreateSession,
  loadComponentSourceRefs,
  loadRawComponents,
  loadSavedComponentSourceRef,
  openPipelineDb,
  storeRawComponents,
} from '../../src/persistence/src/session/repositories/db.js';
import { collectSourceCallSiteEvidence } from '../../src/steps/composition/src/helpers/edges/source-call-site-evidence.js';
import type { RawComponentDefinition } from '../../src/steps/extraction/src/types/component.js';
import { completeSourceFixture } from '../source-fixture.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function directory(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'shared-reference-consumers-')));
  roots.push(root);
  return root;
}

describe('current-session shared reference consumers', () => {
  it('projects generated sources and configured dependencies from the completed capture after files change', async () => {
    const root = directory();
    const source = join(root, 'Surface.tsx');
    const dependency = join(root, 'values.ts');
    const caller = join(root, 'Caller.tsx');
    const text = 'import { label } from "@values"; export function Surface(){return <section>{label}</section>}';
    writeFileSync(source, text);
    writeFileSync(dependency, 'export const label = "CAPTURED_LABEL";');
    writeFileSync(caller, 'import {Surface} from "./Surface"; export const Caller=()=> <Surface/>;');
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { jsx: 'preserve', baseUrl: '.', paths: { '@values': ['./values'] } } }),
    );
    const extracted = await extractReactComponents([source], undefined, {
      projectRoot: root,
      evidenceFilePaths: [caller],
    });
    const dbPath = join(root, 'pipeline.db');
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    const capture = await captureSourceEvidence({
      projectRoot: root,
      filePaths: [source],
      evidenceFilePaths: [caller],
      compilerSources: extracted.compilerSources,
      inventory: extracted.sourceInventory,
    });
    completeExtractionWithSourceEvidence(db, {
      sessionId,
      stepId: createStep(db, sessionId, 'analyze extract', {}),
      components: extracted.components,
      cycles: [],
      scannedFiles: [source],
      capture,
      observations: { accepted: [], rejected: [] },
    });
    const component = loadRawComponents(db, sessionId)[0]!;
    db.prepare('UPDATE raw_components SET status = ? WHERE session_id = ? AND component_id = ?').run(
      'generated',
      sessionId,
      component.component_id,
    );
    const expected = loadSavedComponentSourceRef(db, sessionId, component.component_id, component.name, source);
    db.close();
    writeFileSync(source, 'export function Surface(){return "CHANGED_SOURCE"}');
    rmSync(dependency);
    rmSync(caller);
    const reopened = openPipelineDb(dbPath);
    try {
      const refs = await loadComponentSourceRefs(reopened, sessionId);
      expect(refs).toEqual([expected]);
      expect(refs[0]?.content).toBe(text);
      expect(refs[0]?.siblingFiles?.some((file) => file.content.includes('CAPTURED_LABEL'))).toBe(true);
      expect(refs[0]?.siblingFiles?.some((file) => file.content.includes('const Caller'))).toBe(true);
      expect(refs[0]?.compilerContexts?.[0]?.status).toBe('configured');
    } finally {
      reopened.close();
    }
  });

  it('keeps unavailable saved evidence unknown without falling back to readable live files or another session', async () => {
    const root = directory();
    const source = join(root, 'Surface.tsx');
    writeFileSync(source, 'export function Surface(){return "LIVE_ONLY"}');
    const component: RawComponentDefinition = {
      name: 'Surface',
      source,
      sourcePath: source,
      framework: 'react',
      props: [],
      slots: [],
    };
    const db = openPipelineDb(join(root, 'pipeline.db'));
    try {
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, [component]);
      db.prepare('UPDATE raw_components SET status = ? WHERE session_id = ?').run('generated', sessionId);
      expect(await loadComponentSourceRefs(db, sessionId)).toEqual([
        { component: 'Surface', sourcePath: source, content: null },
      ]);
      const next = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      await completeSourceFixture(db, next.sessionId, root, [component]);
      expect(await loadComponentSourceRefs(db, next.sessionId)).toEqual([]);
      db.prepare('UPDATE raw_components SET status = ? WHERE session_id = ?').run('generated', next.sessionId);
      expect((await loadComponentSourceRefs(db, next.sessionId))[0]?.content).toContain('LIVE_ONLY');
      expect((await loadComponentSourceRefs(db, sessionId))[0]?.content).toBeNull();
    } finally {
      db.close();
    }
  });

  it('does not rebuild a compiler project to infer callers when the shared index is missing', () => {
    const source = '/example/Surface.tsx';
    const result = collectSourceCallSiteEvidence(
      [
        { path: source, content: 'export function Surface(){return <section/>}' },
        {
          path: '/example/Caller.tsx',
          content: 'import {Surface} from "./Surface"; export const Caller=()=> <Surface/>;',
        },
      ],
      [
        { name: 'Surface', source, framework: 'react', props: [], slots: [] },
        { name: 'Caller', source: '/example/Caller.tsx', framework: 'react', props: [], slots: [] },
      ],
    );
    expect(result.accepted).toEqual([]);
    expect(result.coverage.analysis).toBe('configured-lexical-references');
    expect(result.coverage.components.every(({ outcome }) => outcome === 'unknown')).toBe(true);
  });

  it('uses configured symbols for aliases and keeps changed or missing-index sources unknown', async () => {
    const root = directory();
    const source = join(root, 'Surface.tsx');
    const caller = join(root, 'Caller.tsx');
    const files = [
      { path: source, content: 'export function Surface({label}:{label:string}){return <section>{label}</section>}' },
      {
        path: caller,
        content: 'import {Surface as Alias} from "@surface"; export const Caller=()=> <Alias label="sample"/>;',
      },
    ];
    files.forEach(({ path, content }) => writeFileSync(path, content));
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { jsx: 'preserve', baseUrl: '.', paths: { '@surface': ['./Surface'] } } }),
    );
    const extracted = await extractReactComponents([source], undefined, {
      projectRoot: root,
      evidenceFilePaths: [caller],
    });
    const components = [
      ...extracted.components,
      { name: 'Missing', source: join(root, 'Missing.tsx'), framework: 'react' as const, props: [], slots: [] },
    ];
    const indexed = collectSourceCallSiteEvidence(files, components);
    expect(indexed.accepted).toHaveLength(1);
    expect(indexed.accepted[0]?.inputs).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'label', value: 'sample' })]),
    );
    expect(indexed.coverage.components.find(({ name }) => name === 'Missing')?.outcome).toBe('unknown');
    const stale = collectSourceCallSiteEvidence(
      files.map((file) => (file.path === caller ? { ...file, content: 'changed' } : file)),
      components,
    );
    expect(stale.accepted).toEqual([]);
    expect(stale.rejected[0]?.reason).toBe('unbound-component');
    expect(stale.coverage.components.find(({ name }) => name === 'Surface')).toMatchObject({
      referenceCount: 0,
      outcome: 'unknown',
    });
    const moved = collectSourceCallSiteEvidence(
      files,
      extracted.components.map((component) => ({ ...component, sourcePath: join(root, 'Other.tsx') })),
    );
    expect(moved.accepted).toEqual([]);
    expect(moved.coverage.components[0]?.outcome).toBe('unknown');
    const corrupt = structuredClone(extracted.components);
    Object.assign(corrupt[0]!.componentFacts!.sourceObservations!.referenceIndex!, { schemaVersion: 2 });
    const unavailable = collectSourceCallSiteEvidence(files, corrupt);
    expect(unavailable.accepted).toEqual([]);
    expect(unavailable.coverage.components[0]?.outcome).toBe('unknown');
  });
});
