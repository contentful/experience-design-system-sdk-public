import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { extractReactComponents, captureSourceEvidence } from '@contentful/experience-design-system-extraction';
import { validateCDF, buildCDF } from '@contentful/experience-design-system-types';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  storeRawComponents,
  loadRawComponents,
  completeExtractionWithSourceEvidence,
  loadCDFComponents,
  storeCDFComponents,
  loadPropertyDecisions,
  applyToolCalls,
} from '../src/persistence/src/session/repositories/db.js';
import { runOneGenerateComponent } from '../src/orchestrators/run-generate-components-session/helpers/run-one-generate-component.js';
import { materializeProperty } from '../src/steps/generation/src/services/property/materialize-property.js';
import { runCdfGenerationService } from '../src/steps/generation/src/services/run-cdf-generation-service.js';
const fake = vi.hoisted(() => ({ stdout: '', prompts: [] as string[] }));
vi.mock('../src/agents/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createLocalCliAgentInvoker: () => ({
    invoke: async ({ prompt }: { prompt: string }) => {
      fake.prompts.push(prompt);
      return { stdout: fake.stdout, stderr: '', exitCode: 0, timedOut: false };
    },
  }),
}));
let directory = '';
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});
it('connects actual producer to saved source, fresh session/direct generation, unrelated save, reopen and CDF', async () => {
  directory = mkdtempSync(join(tmpdir(), 'native-connected-'));
  const file = join(directory, 'Example.tsx');
  writeFileSync(
    file,
    `type Values={ '__proto__'?:boolean; 'a.b/λ':0|1; constructor?:string }; type Props={rows:Array<Partial<Values>>;tags:string[];settings:Pick<Values,'a.b/λ'>}; export function Example({rows=[{['__proto__']:false,'a.b/λ':0}],tags=[],settings={'a.b/λ':0}}:Props){return <div>{rows.length}{tags.length}{settings['a.b/λ']}</div>;}`,
  );
  const extracted = await extractReactComponents([file]);
  const component = extracted.components.find((c) => c.name === 'Example')!;
  expect(component.sourceCandidates?.find((c) => c.name === 'rows')?.facts?.advisoryShape?.$type).toBe('array');
  const dbPath = join(directory, 'pipeline.db');
  let db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, [component]);
  const saved = loadRawComponents(db, sessionId)[0]!;
  const capture = await captureSourceEvidence({
    projectRoot: directory,
    filePaths: [file],
    components: [{ componentId: saved.component_id, name: saved.name, sourcePath: file }],
  });
  completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId: createStep(db, sessionId, 'analyze extract', { project: directory }),
    components: [component],
    cycles: [],
    scannedFiles: [file],
    capture,
    observations: { accepted: [], rejected: [] },
  });
  db.close();
  db = openPipelineDb(dbPath);
  const fresh = loadRawComponents(db, sessionId)[0]!;
  expect(fresh.sourceEvidenceReadStatus).toBe('available');
  const snapshot = JSON.stringify(fresh.sourceCandidates);
  const calls = fresh.props.map((prop) => {
    const shape = fresh.sourceCandidates!.find((c) => c.name === prop.name)!.facts!.advisoryShape!;
    return {
      tool: 'classify_prop',
      prop: prop.name,
      cdf_type: shape.$type,
      cdf_category: 'content',
      ...(shape.$items ? { items: shape.$items } : {}),
      ...(shape.$fields ? { fields: shape.$fields } : {}),
    };
  });
  fake.stdout = calls.map((call) => JSON.stringify(call)).join('\n');
  const prompts: string[] = [];
  const generated = await runOneGenerateComponent(
    {
      db,
      sessionId,
      invoker: {
        checkAuth: async () => 'ok',
        invoke: async (request) => {
          prompts.push(request.prompt);
          return { stdout: fake.stdout, stderr: '', exitCode: 0, timedOut: false };
        },
      },
      agent: 'claude',
      model: undefined,
      tokensInline: undefined,
      tokenMapInline: undefined,
      verbose: false,
      noCache: true,
      skillPathOverride: undefined,
      skillContentOverride: 'Generate exact source-supported native definitions',
      promptHash: 'example',
      existingContentfulEntities: undefined,
      existingTokensInline: undefined,
      precomputedCachedNames: new Set(),
      allowedComponentNames: new Set(['Example']),
      onProgress: undefined,
    },
    fresh,
    0,
    1,
  );
  expect(generated.failed).toBe(false);
  expect(generated.classified).toBe(3);
  expect(prompts[0]).toContain('sourceGraph');
  expect(prompts[0]).toContain('a.b/λ');
  const first = loadCDFComponents(db, sessionId)[0]!;
  expect(first.entry.$properties.rows?.$default).toEqual(JSON.parse('[{"__proto__":false,"a.b/λ":0}]'));
  expect(first.entry.$properties.tags?.$default).toEqual([]);
  expect(first.entry.$properties.settings?.$default).toEqual({ 'a.b/λ': 0 });
  const direct = await runCdfGenerationService({
    components: [fresh],
    agent: 'claude',
    skillContentOverride: 'Generate exact source-supported native definitions',
  });
  expect(direct.failures).toEqual([]);
  expect(direct.components[0]?.$properties).toEqual(first.entry.$properties);
  storeCDFComponents(db, sessionId, [{ key: 'Example', entry: { ...first.entry, $description: 'Unrelated edit' } }]);
  db.close();
  db = openPipelineDb(dbPath);
  const reopened = loadCDFComponents(db, sessionId)[0]!;
  expect(reopened.entry.$properties).toEqual(first.entry.$properties);
  expect(JSON.stringify(loadRawComponents(db, sessionId)[0]!.sourceCandidates)).toBe(snapshot);
  expect(loadPropertyDecisions(db, sessionId).every((decision) => decision.revision === 2)).toBe(true);
  const before = JSON.stringify(loadCDFComponents(db, sessionId));
  expect(() =>
    applyToolCalls(
      db,
      sessionId,
      fresh.component_id,
      'Example',
      [
        {
          tool: 'classify_prop',
          prop: 'rows',
          cdf_type: 'array',
          cdf_category: 'content',
          items: first.entry.$properties.rows!.$items,
          default: [{ 'a.b/λ': 2 }],
        },
      ],
      [],
    ),
  ).toThrow();
  expect(JSON.stringify(loadCDFComponents(db, sessionId))).toBe(before);
  const cdf = buildCDF([reopened], []);
  expect(validateCDF(cdf).valid).toBe(true);
  expect(JSON.parse(JSON.stringify(cdf))).toEqual(cdf);
  db.close();
});

it('saves explicit unsupported deeper outcomes and alternatives without activating or pruning source', async () => {
  directory = mkdtempSync(join(tmpdir(), 'native-deep-'));
  const file = join(directory, 'Deep.tsx');
  writeFileSync(
    file,
    `type Props={config:{nested:{title:string}}};export function Deep({config=getConfig()}:Props){return <div>{config.nested.title}</div>;}`,
  );
  const component = (await extractReactComponents([file])).components.find((c) => c.name === 'Deep')!;
  const db = openPipelineDb(':memory:');
  try {
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    storeRawComponents(db, sessionId, [component]);
    const saved = loadRawComponents(db, sessionId)[0]!;
    const snapshot = JSON.stringify(saved.sourceCandidates);
    const shape = saved.sourceCandidates!.find((c) => c.name === 'config')!.facts!.advisoryShape!;
    const result = applyToolCalls(
      db,
      sessionId,
      saved.component_id,
      'Deep',
      [{ tool: 'classify_prop', prop: 'config', cdf_type: 'record', cdf_category: 'content', fields: shape.$fields }],
      [],
    );
    expect(result).toMatchObject({ projectionBlocked: true, classified: 0 });
    expect(loadPropertyDecisions(db, sessionId)[0]!.decision).toMatchObject({
      admission: 'unsupported',
      projection: { outcome: 'unsupported' },
      alternatives: expect.arrayContaining([expect.objectContaining({ mapper: 'unknown', approved: false })]),
    });
    expect(JSON.stringify(loadRawComponents(db, sessionId)[0]!.sourceCandidates)).toBe(snapshot);
    expect(loadCDFComponents(db, sessionId)[0]?.entry.$properties.config).toBeUndefined();
  } finally {
    db.close();
  }
});

it('binds declarationless mapped properties to the captured graph fallback location', async () => {
  directory = mkdtempSync(join(tmpdir(), 'native-mapped-'));
  const file = join(directory, 'Mapped.tsx');
  writeFileSync(
    file,
    `type Props = { [K in '__proto__' | 'a.b/λ']?: string[] }; export function Mapped(props: Props) { return <div/>; }`,
  );
  const component = (await extractReactComponents([file])).components.find((c) => c.name === 'Mapped')!;
  const candidate = component.sourceCandidates!.find((c) => c.name === 'a.b/λ')!;
  expect(candidate.facts!.declarations).toEqual([]);
  expect(candidate.facts!.sourceGraph!.nodes[0]!.declarations[0]!.textHash).toBeTruthy();
  const materialized = materializeProperty(component, {
    tool: 'classify_prop',
    prop: candidate.name,
    cdf_type: 'array',
    cdf_category: 'content',
    items: { $type: 'string', $required: true },
  });
  expect(materialized.model!.identity.sourceRevision).not.toBe('');
});

it('retains unsafe numeric-domain outcomes without activating rounded native values', async () => {
  directory = mkdtempSync(join(tmpdir(), 'native-number-'));
  const file = join(directory, 'Numeric.tsx');
  writeFileSync(
    file,
    `type Props = { count: 9007199254740993 }; export function Numeric({count=9007199254740993}: Props) { return <div/>; }`,
  );
  const component = (await extractReactComponents([file])).components.find((c) => c.name === 'Numeric')!;
  const db = openPipelineDb(':memory:');
  try {
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    storeRawComponents(db, sessionId, [component]);
    const saved = loadRawComponents(db, sessionId)[0]!;
    expect(
      applyToolCalls(
        db,
        sessionId,
        saved.component_id,
        saved.name,
        [{ tool: 'classify_prop', prop: 'count', cdf_type: 'number', cdf_category: 'content' }],
        [],
      ),
    ).toMatchObject({ projectionBlocked: true, classified: 0 });
    expect(loadPropertyDecisions(db, sessionId)[0]!.decision).toMatchObject({ admission: 'unsupported' });
    expect(loadCDFComponents(db, sessionId)[0]?.entry.$properties.count).toBeUndefined();
    expect(loadRawComponents(db, sessionId)[0]!.sourceCandidates![0]!.facts!.sourceDefault!.expression).toBe(
      '9007199254740993',
    );
  } finally {
    db.close();
  }
});

it('applies nested source-mapper default eligibility without erasing the saved representation evidence', async () => {
  directory = mkdtempSync(join(tmpdir(), 'native-default-'));
  const file = join(directory, 'Defaults.tsx');
  writeFileSync(
    file,
    `type Props={settings:{image:string;title:string}};export function Defaults({settings}:Props){return <div/>;}`,
  );
  const component = (await extractReactComponents([file])).components.find((c) => c.name === 'Defaults')!;
  const materialized = materializeProperty(component, {
    tool: 'classify_prop',
    prop: 'settings',
    cdf_type: 'record',
    cdf_category: 'content',
    fields: { image: { $type: 'media', $default: 'example.png' }, title: { $type: 'string', $default: '' } },
  });
  expect(materialized.projection!.outcome).toBe('lossy');
  expect(Object.hasOwn(materialized.definition.$fields!.image!, '$default')).toBe(false);
  expect(materialized.definition.$fields!.title!.$default).toBe('');
  expect(materialized.model!.representation!.$fields!.image!.$default).toBe('example.png');
  expect(materialized.projection!.issues).toContainEqual({
    path: '/fields/image/defaultValue',
    message: 'Source mapper and mapped target must both support default',
  });
  const db = openPipelineDb(':memory:');
  try {
    const { sessionId } = getOrCreateSession(db, 'new', 'example', { command: 'analyze extract' });
    storeRawComponents(db, sessionId, [component]);
    const saved = loadRawComponents(db, sessionId)[0]!;
    applyToolCalls(
      db,
      sessionId,
      saved.component_id,
      saved.name,
      [
        {
          tool: 'classify_prop',
          prop: 'settings',
          cdf_type: 'record',
          cdf_category: 'content',
          fields: materialized.model!.representation!.$fields,
        },
      ],
      [],
    );
    const entry = loadCDFComponents(db, sessionId)[0]!.entry;
    expect(Object.hasOwn(entry.$properties.settings!.$fields!.image!, '$default')).toBe(false);
    const before = JSON.stringify(loadPropertyDecisions(db, sessionId));
    entry.$properties.settings!.$fields!.image!.$default = 'example.png';
    expect(() => storeCDFComponents(db, sessionId, [{ key: saved.name, entry }])).toThrow('Default unavailable');
    expect(JSON.stringify(loadPropertyDecisions(db, sessionId))).toBe(before);
  } finally {
    db.close();
  }
});
