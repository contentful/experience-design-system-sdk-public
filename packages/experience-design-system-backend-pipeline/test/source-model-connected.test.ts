import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { extractReactComponents, captureSourceEvidence } from '../src/steps/extraction/index.js';
import {
  buildCDF,
  validateCDF,
  cloneJson,
  validateRepresentationPlan,
  evaluateRepresentationReadiness,
  deriveEditableRepresentationPlans,
  cdfToTarget,
  buildFilteredCDF,
} from '@contentful/experience-design-system-types';
import { contentDigest } from '../../experience-design-system-types/src/property-contract/content-digest.js';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  loadRawComponents,
  createStep,
  completeExtractionWithSourceEvidence,
  applyToolCalls,
  loadCDFComponents,
  storeCDFComponents,
  loadSelectedCDFComponents,
  evaluateComponentReadiness,
  loadPropertyDecisions,
} from '../src/persistence/src/session/repositories/db.js';
import { ApiClient } from '../src/steps/apply/src/helpers/api-client/api-client.js';
import {
  analyzePropertyRepresentations,
  selectRepresentationPlan,
  loadRepresentationPlans,
  representationContext,
  currentRepresentationModel,
} from '../src/persistence/src/session/repositories/representation-plans.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'source-model-'));
  directories.push(directory);
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, jsx: 'preserve' } }),
  );
  const file = join(directory, 'Example.tsx');
  writeFileSync(
    file,
    `type Detail={ title: 'a'|'b'; nested?:{ flag:boolean } }; type Props={ settings:Detail; rows:Detail[]; pair:[string,Detail?] }; export function Example({settings={title:'a'},rows=[],pair=['']}:Props){return <div>{settings.title}{rows.length}{pair.length}</div>;} export function Other({settings}:Pick<Props,'settings'>){return <div>{settings.title}</div>;} export function UnknownExample({opaque}:{opaque:unknown}){return <div/>;}`,
  );
  const extracted = await extractReactComponents([file]);
  const path = join(directory, 'pipeline.db');
  const db = openPipelineDb(path);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, extracted.components);
  const saved = loadRawComponents(db, sessionId);
  const capture = await captureSourceEvidence({
    projectRoot: directory,
    filePaths: [file],
    compilerSources: extracted.compilerSources,
    components: saved.map((row) => ({ componentId: row.component_id, name: row.name, sourcePath: file })),
  });
  completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId: createStep(db, sessionId, 'analyze extract', { project: directory }),
    components: extracted.components,
    cycles: [],
    scannedFiles: [file],
    capture,
    observations: { accepted: [], rejected: [] },
  });
  const fresh = loadRawComponents(db, sessionId);
  for (const component of fresh)
    applyToolCalls(
      db,
      sessionId,
      component.component_id,
      component.name,
      [
        { tool: 'classify_component' },
        ...(component.sourceCandidates ?? []).map((candidate) =>
          candidate.name === 'opaque'
            ? { tool: 'exclude_prop' as const, prop: candidate.name, reason: 'No editable source value' }
            : {
                tool: 'classify_prop' as const,
                prop: candidate.name,
                cdf_category: 'content' as const,
                reason: 'Choose source representation in review',
              },
        ),
      ],
      [],
    );
  return { db, path, sessionId, fresh };
}

it('matches the stable browser digest to Node SHA-256 for canonical Unicode JSON', () => {
  for (const value of [
    null,
    false,
    0,
    'λ',
    { a: 1, b: ['x', false] },
    JSON.parse('{"__proto__":false,"constructor":0}'),
  ])
    expect(contentDigest(value)).toBe(createHash('sha256').update(JSON.stringify(value)).digest('hex'));
  expect(contentDigest({ b: 2, a: 1 })).toBe(contentDigest({ a: 1, b: 2 }));
});
it('derives compiler-owned records, repeated and tuple models without names and retains opaque holds', async () => {
  const { db, sessionId, fresh } = await fixture();
  const owner = fresh.find((row) => row.name === 'Example')!;
  const sourceBefore = JSON.stringify(owner.sourceCandidates);
  for (const property of ['settings', 'rows', 'pair']) {
    const model = currentRepresentationModel(db, sessionId, owner.component_id, property);
    const plans = analyzePropertyRepresentations(db, sessionId, owner.component_id, property);
    const plan = plans.find((choice) => choice.kind === 'component-model')!;
    expect(plan.sdkValid, JSON.stringify(plan.issues)).toBe(true);
    expect(plan.mappings.map((mapping) => mapping.nodeId).sort()).toEqual(
      model.source.graph.nodes.map((node) => node.id).sort(),
    );
    expect(
      validateRepresentationPlan(plan, model, representationContext(db, sessionId, owner.component_id, property)),
    ).toEqual([]);
    expect(evaluateRepresentationReadiness(plan).ready).toBe(false);
    if (property === 'settings')
      expect(plan.models.some((generated) => generated.entry.$properties.nested?.$type === 'record')).toBe(true);
    else if (property === 'pair')
      expect(plan.models.flatMap((generated) => Object.values(generated.entry.$slots ?? {})).length).toBeGreaterThan(0);
    if (property === 'rows') {
      expect(plan.attachment?.definition.$cardinality?.ordered).toBe(true);
      expect(plan.mappings.some((mapping) => mapping.reconstruction?.kind === 'ordered-array')).toBe(true);
      expect(plan.attachment?.definition.$allowedComponents).toEqual(plan.models.map((generated) => generated.key));
    }
    if (property === 'pair')
      expect(plan.models.some((generated) => generated.entry.$slots?.position_1?.$cardinality?.min === 0)).toBe(true);
    const renamed = cloneJson(model);
    renamed.identity.componentId = 'unrelated-owner';
    renamed.identity.propertyId = 'unrelated-property';
    expect(
      deriveEditableRepresentationPlans(renamed).find((choice) => choice.kind === 'component-model')!.models[0]!.key,
    ).not.toBe(plan.models[0]!.key);
    const forged = cloneJson(plan);
    forged.mappings.pop();
    expect(
      validateRepresentationPlan(forged, model, representationContext(db, sessionId, owner.component_id, property))
        .length,
    ).toBeGreaterThan(0);
  }
  const opaque = fresh.find((row) => row.name === 'UnknownExample')!;
  expect(() => analyzePropertyRepresentations(db, sessionId, opaque.component_id, 'opaque')).toThrow('Excluded');
  expect(
    JSON.stringify(
      loadRawComponents(db, sessionId).find((row) => row.component_id === owner.component_id)!.sourceCandidates,
    ),
  ).toBe(sourceBefore);
  db.close();
});
it('atomically selects, edits, reopens and exports only reachable desired models while preview remains held', async () => {
  const { db: initialDb, path, sessionId, fresh } = await fixture();
  let db = initialDb;
  const owner = fresh.find((row) => row.name === 'Example')!,
    other = fresh.find((row) => row.name === 'Other')!;
  applyToolCalls(
    db,
    sessionId,
    owner.component_id,
    owner.name,
    [
      { tool: 'classify_component' },
      {
        tool: 'classify_prop',
        prop: 'settings',
        cdf_category: 'content',
        cdf_type: 'record',
        fields: {
          title: { $type: 'string', $required: true, $values: ['a', 'b'] },
          nested: { $type: 'record', $required: false, $fields: { flag: { $type: 'boolean', $required: true } } },
        },
      },
      {
        tool: 'classify_prop',
        prop: 'rows',
        cdf_category: 'content',
        reason: 'Choose source representation in review',
      },
      {
        tool: 'classify_prop',
        prop: 'pair',
        cdf_category: 'content',
        reason: 'Choose source representation in review',
      },
    ],
    [],
  );
  for (const property of ['settings', 'rows', 'pair'])
    selectRepresentationPlan(db, sessionId, owner.component_id, property, 'component-model');
  selectRepresentationPlan(db, sessionId, other.component_id, 'settings', 'component-model');
  const readiness = evaluateComponentReadiness(db, sessionId, owner.component_id);
  expect(readiness.definition.ready, JSON.stringify(readiness)).toBe(true);
  expect(evaluateComponentReadiness(db, sessionId, owner.component_id).import.ready).toBe(false);
  expect(() => loadSelectedCDFComponents(db, sessionId, new Set([owner.component_id]))).toThrow('not ready');
  const model = currentRepresentationModel(db, sessionId, owner.component_id, 'settings');
  const proposal = {
    ...model.identity,
    name: 'settings',
    sourceNodeIds: model.source.graph.nodes.map((node) => node.id),
    declaredConstraints: [],
    provenConstraints: [],
    observations: [],
    judgment: 'Use the source-owned editable model',
    desiredType: 'Record' as const,
    desiredDefinition: cdfToTarget(model.representation!),
  };
  delete (proposal as Partial<typeof model.identity>).nodeId;
  for (const forged of [
    { ...proposal, name: 'wrong' },
    { ...proposal, sourceRevision: 'stale' },
    { ...proposal, readiness: { status: 'enabled' } },
  ])
    expect(() =>
      selectRepresentationPlan(db, sessionId, owner.component_id, 'settings', 'component-model', forged),
    ).toThrow();
  selectRepresentationPlan(db, sessionId, owner.component_id, 'settings', 'component-model', proposal);
  const current = loadCDFComponents(db, sessionId).find((row) => row.componentId === owner.component_id)!;
  expect(current.entry.$representationPlans!.settings!.proposal?.judgment).toBe(proposal.judgment);
  const previous = loadRepresentationPlans(db, sessionId, owner.component_id);
  storeCDFComponents(db, sessionId, [current]);
  expect(loadRepresentationPlans(db, sessionId, owner.component_id)).toEqual(previous);
  const edited = cloneJson(current);
  const plan = edited.entry.$representationPlans!.settings!;
  const field = plan.models.find((row) => row.entry.$properties.title)!;
  field.entry.$properties.title!.$default = 'b';
  storeCDFComponents(db, sessionId, [edited]);
  const canonical = loadCDFComponents(db, sessionId).find((row) => row.componentId === owner.component_id)!;
  expect(canonical.entry.$representationPlans!.settings!.id).not.toBe(plan.id);
  expect(
    canonical.entry.$representationPlans!.settings!.models.find((row) => row.entry.$properties.title)!.entry.$properties
      .title!.$default,
  ).toBe('b');
  const before = JSON.stringify(loadRepresentationPlans(db, sessionId));
  const invalid = cloneJson(canonical);
  invalid.entry.$representationPlans!.settings!.identity.componentId = 'wrong-owner';
  expect(() => storeCDFComponents(db, sessionId, [invalid])).toThrow();
  expect(JSON.stringify(loadRepresentationPlans(db, sessionId))).toBe(before);
  const late = db
    .prepare(
      "SELECT plan_json FROM selected_representation_plans WHERE session_id=? AND component_id=? AND property_name='settings'",
    )
    .get(sessionId, owner.component_id);
  db.exec(
    "CREATE TEMP TRIGGER fail_selected_save BEFORE UPDATE ON selected_representation_plans BEGIN SELECT RAISE(ABORT,'late save failure'); END",
  );
  const failing = cloneJson(canonical);
  failing.entry.$description = 'uncommitted';
  failing.entry.$representationPlans!.settings!.models.find(
    (row) => row.entry.$properties.title,
  )!.entry.$properties.title!.$description = 'changed';
  expect(() => storeCDFComponents(db, sessionId, [failing])).toThrow('late save failure');
  expect(
    loadCDFComponents(db, sessionId).find((row) => row.componentId === owner.component_id)!.entry.$description,
  ).toBeUndefined();
  expect(
    db
      .prepare(
        "SELECT plan_json FROM selected_representation_plans WHERE session_id=? AND component_id=? AND property_name='settings'",
      )
      .get(sessionId, owner.component_id),
  ).toEqual(late);
  db.close();
  db = openPipelineDb(path);
  const selected = loadSelectedCDFComponents(db, sessionId, new Set([owner.component_id]), undefined, 'definition');
  expect(selected.some((row) => row.componentId === other.component_id)).toBe(false);
  const otherKeys = new Set(
    loadRepresentationPlans(db, sessionId, other.component_id).flatMap((row) =>
      row.plan.models.map((model) => model.key),
    ),
  );
  expect(selected.some((row) => otherKeys.has(row.key))).toBe(false);
  const full = buildCDF(selected, [])!;
  expect(validateCDF(full).valid).toBe(true);
  expect(buildFilteredCDF(full, new Set([owner.name]), new Set())).toEqual(full);
  const client = new ApiClient({
    host: 'https://api.example.com',
    cmaToken: 'example',
    spaceId: 'example',
    environmentId: 'example',
  });
  await expect(client.previewImport(full)).rejects.toThrow('component-model-mapper remains unverified');
  await expect(client.applyImport(full, { acknowledgeBreakingChanges: true })).rejects.toThrow(
    'component-model-mapper remains unverified',
  );
  expect(selected.length).toBe(
    1 +
      loadRepresentationPlans(db, sessionId, owner.component_id).reduce((sum, row) => sum + row.plan.models.length, 0),
  );
  const decisions = loadPropertyDecisions(db, sessionId);
  expect(decisions.filter((row) => row.componentId === owner.component_id)).toHaveLength(3);
  db.close();
});

it('holds only token-context owners until explicit readoption after value, kind and default-name changes', async () => {
  const { db, sessionId, fresh } = await fixture();
  const owner = fresh.find((row) => row.name === 'Example')!;
  const other = fresh.find((row) => row.name === 'Other')!;
  db.prepare('INSERT INTO raw_tokens(session_id,path,type,value) VALUES (?,?,?,?)').run(
    sessionId,
    'example.choice',
    'string',
    '"a"',
  );
  db.prepare(
    'INSERT INTO raw_prop_token_paths(session_id,component_id,prop_name,source,position,path) VALUES (?,?,?,?,?,?)',
  ).run(sessionId, owner.component_id, 'settings', 'review', 0, 'example.choice');
  for (const property of ['settings', 'rows', 'pair'])
    selectRepresentationPlan(db, sessionId, owner.component_id, property, 'component-model');
  selectRepresentationPlan(db, sessionId, other.component_id, 'settings', 'component-model');
  expect(evaluateComponentReadiness(db, sessionId, owner.component_id).definition.ready).toBe(true);
  const unrelatedId = loadRepresentationPlans(db, sessionId, other.component_id)[0]!.plan.id;
  for (const [type, value] of [
    ['string', '"b"'],
    ['number', '2'],
  ]) {
    const previous = loadRepresentationPlans(db, sessionId, owner.component_id).find(
      (row) => row.propertyName === 'settings',
    )!.plan.id;
    db.prepare('UPDATE raw_tokens SET type=?,value=? WHERE session_id=? AND path=?').run(
      type!,
      value!,
      sessionId,
      'example.choice',
    );
    expect(evaluateComponentReadiness(db, sessionId, owner.component_id).definition.ready).toBe(false);
    expect(evaluateComponentReadiness(db, sessionId, other.component_id).definition.ready).toBe(true);
    expect(() =>
      loadSelectedCDFComponents(db, sessionId, new Set([owner.component_id]), undefined, 'definition'),
    ).toThrow('not ready');
    selectRepresentationPlan(db, sessionId, owner.component_id, 'settings', 'component-model');
    expect(
      loadRepresentationPlans(db, sessionId, owner.component_id).find((row) => row.propertyName === 'settings')!.plan
        .id,
    ).not.toBe(previous);
    expect(evaluateComponentReadiness(db, sessionId, owner.component_id).definition.ready).toBe(true);
    expect(loadRepresentationPlans(db, sessionId, other.component_id)[0]!.plan.id).toBe(unrelatedId);
  }
  const raw = db
    .prepare('SELECT default_value FROM raw_props WHERE session_id=? AND component_id=? AND name=?')
    .get(sessionId, owner.component_id, 'settings')!;
  db.prepare('INSERT INTO raw_token_name_paths(session_id,raw_name,path,source) VALUES (?,?,?,?)').run(
    sessionId,
    raw.default_value!,
    'example.choice',
    'manual',
  );
  expect(evaluateComponentReadiness(db, sessionId, owner.component_id).definition.ready).toBe(false);
  expect(evaluateComponentReadiness(db, sessionId, other.component_id).definition.ready).toBe(true);
  selectRepresentationPlan(db, sessionId, owner.component_id, 'settings', 'component-model');
  expect(evaluateComponentReadiness(db, sessionId, owner.component_id).definition.ready).toBe(true);
  db.close();
});
