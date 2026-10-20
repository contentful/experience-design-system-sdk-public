import { expect, it } from 'vitest';
import {
  createPropertyProfile,
  LOCAL_NATIVE_PROPERTY_PROFILE,
  projectProperty,
  validateTargetDefinition,
  jsonValueIssue,
  jsonEqual,
  parseRepresentationProposalDrafts,
  validateRepresentationProposal,
  validateSourceGraph,
  type PropertyModel,
  type TargetDefinition,
} from '../src/index.js';
const scalar = (value: unknown) => ({ type: 'Number', defaultValue: value });
const model = (): PropertyModel => ({
  identity: { componentId: 'Example', propertyId: 'p', key: 'count', sourceRevision: 'rev', nodeId: 'n0' },
  source: {
    typeText: '0 | 1',
    shape: { $type: 'number', $required: false },
    observations: [],
    graph: {
      schemaVersion: 1,
      rootId: 'n0',
      nodes: [
        {
          id: 'n0',
          keyPath: ['count'],
          kind: 'number',
          typeText: '0 | 1',
          required: false,
          domain: { openness: 'closed', declaredValues: [0, 1], provenance: 'compiler' },
          coverage: 'complete-within-declared-bound',
          reason: null,
        },
      ],
      coverage: 'complete-within-declared-bound',
      limits: { maxDepth: 16, maxNodes: 512, maxFields: 2048 },
      omittedCount: 0,
    },
  },
  category: 'content',
  representation: { $type: 'number', $required: false },
  defaultIntent: { action: 'set', value: 0 },
});
const context = { capabilities: { ':mapper': 'enabled' as const, ':default': 'enabled' as const } };

it.each([
  { type: 'String', defaultValue: '' },
  { type: 'Number', defaultValue: 0 },
  { type: 'Boolean', defaultValue: false },
  { type: 'Array', items: { type: 'String' }, defaultValue: [] },
  { type: 'Record', fields: { text: { type: 'String', required: false } }, defaultValue: {} },
  { type: 'Integer', defaultValue: 1 },
  { type: 'DateTime', defaultValue: 'date' },
  { type: 'RichText' },
  { type: 'JSON' },
  {
    type: 'ResourceLink',
    allowedResources: [{ type: 'Entry', source: 'same-space' }],
    defaultValue: { id: 'example' },
  },
  { type: 'Literal', value: null, valueType: { type: 'JSON' }, defaultValue: null },
] as TargetDefinition[])('validates modeled $type independently of mapper deployment', (definition) =>
  expect(validateTargetDefinition(definition).valid).toBe(true),
);
it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe numbers with exact path', (value) =>
  expect(validateTargetDefinition(scalar(value)).issues[0]?.path).toBe('/defaultValue'),
);
it('rejects cycles, sparse arrays, symbols, accessors and custom prototypes without executing accessors', () => {
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  const sparse = new Array(1);
  const getter = Object.defineProperty({}, 'x', {
    get: () => {
      throw new Error('must not run');
    },
    enumerable: true,
  });
  for (const value of [cyclic, sparse, getter, new Date(), { [Symbol('x')]: 1 }, Object.assign([], { extra: true })])
    expect(jsonValueIssue(value)).toBeTruthy();
  const aliased = { value: 1 };
  expect(jsonEqual({ a: aliased, b: aliased }, { b: { value: 1 }, a: { value: 1 } })).toBe(true);
  expect(jsonValueIssue({ a: aliased, b: aliased })).toBeUndefined();
});
it('snapshots revision two profile lists and enforces both default capability gates', () => {
  const mutable = {
    ...LOCAL_NATIVE_PROPERTY_PROFILE,
    mapperTypes: [...LOCAL_NATIVE_PROPERTY_PROFILE.mapperTypes],
    defaultSourceTypes: ['number'],
    defaultTargetTypes: ['Number' as const],
  };
  const profile = createPropertyProfile(mutable);
  mutable.defaultSourceTypes.length = 0;
  expect(profile.defaultSourceTypes).toEqual(['number']);
  expect(Object.isFrozen(profile.defaultSourceTypes)).toBe(true);
  expect(() => createPropertyProfile({ ...mutable, defaultTargetTypes: ['Integer'] })).toThrow();
  expect(projectProperty(model(), profile, context)).toMatchObject({
    outcome: 'supported',
    target: { defaultValue: 0 },
  });
  expect(
    projectProperty(model(), createPropertyProfile({ ...mutable, defaultTargetTypes: ['Number'] }), context),
  ).toMatchObject({ outcome: 'lossy' });
  const noMappedDefault = createPropertyProfile({ ...profile, defaultTargetTypes: [] });
  expect(projectProperty(model(), noMappedDefault, context)).toMatchObject({
    outcome: 'lossy',
    target: { type: 'Number' },
  });
  expect(projectProperty(model(), noMappedDefault, context).target).not.toHaveProperty('defaultValue');
  expect(projectProperty(model(), profile, { capabilities: {} }).outcome).toBe('conditional');
  expect(projectProperty(model(), profile, { capabilities: { ':mapper': 'unavailable' } }).outcome).toBe('unsupported');
});
it('checks every proven source value and default; observations never narrow open domains', () => {
  const original = model();
  expect(
    projectProperty({ ...original, defaultIntent: { action: 'set', value: 2 } }, LOCAL_NATIVE_PROPERTY_PROFILE, context)
      .outcome,
  ).toBe('unsupported');
  original.source.graph.nodes[0]!.domain.declaredValues = [0, 'wrong'];
  expect(projectProperty(original, LOCAL_NATIVE_PROPERTY_PROFILE, context).outcome).toBe('unsupported');
  original.source.graph.nodes[0]!.domain = { openness: 'open', declaredValues: [], provenance: 'compiler' };
  original.source.observations = [0];
  expect(
    projectProperty({ ...original, defaultIntent: { action: 'set', value: 2 } }, LOCAL_NATIVE_PROPERTY_PROFILE, context)
      .outcome,
  ).toBe('supported');
});
it('stages typed proposals only and rejects readiness forgery, stale identity and node references', () => {
  const source = model();
  const draft = {
    componentId: 'Example',
    propertyId: 'p',
    key: 'count',
    name: 'Count',
    sourceRevision: 'rev',
    sourceNodeIds: ['n0'],
    declaredConstraints: [],
    provenConstraints: [],
    observations: [],
    judgment: 'Use numeric input',
    desiredType: 'Number',
    desiredDefinition: { type: 'Number' },
  };
  expect(parseRepresentationProposalDrafts(JSON.stringify(draft)).drafts).toEqual([draft]);
  const readiness = () => ({
    status: 'unknown' as const,
    requirements: [{ path: '', capability: 'mapper', availability: 'unknown' as const }],
  });
  expect(validateRepresentationProposal(draft, source, readiness)).toMatchObject({
    valid: true,
    proposal: { readiness: { status: 'unknown' } },
  });
  for (const invalid of [
    { ...draft, readiness: { status: 'enabled' } },
    { ...draft, sourceRevision: 'stale' },
    { ...draft, sourceNodeIds: ['missing'] },
    { ...draft, desiredType: 'String' },
  ])
    expect(validateRepresentationProposal(invalid, source, readiness).valid).toBe(false);
});

it('refuses a source domain with unrepresentable numeric literals while retaining exact evidence', () => {
  const source = model();
  Object.assign(source.source.graph.nodes[0]!.domain, {
    declaredValues: [],
    unrepresentedValues: [{ typeText: '9007199254740993', reason: 'unsafe-number' }],
  });
  source.source.graph.coverage = 'partial';
  const result = projectProperty(source, LOCAL_NATIVE_PROPERTY_PROFILE, context);
  expect(result.outcome).toBe('unsupported');
  expect(result.issues).toContainEqual({
    path: '/sourceDomain',
    message: 'Source domain contains unrepresentable values',
  });
  expect(result.model.source.graph.nodes[0]!.domain).toHaveProperty('unrepresentedValues', [
    { typeText: '9007199254740993', reason: 'unsafe-number' },
  ]);
});

it('returns diagnostics for malformed saved source nodes without throwing', () => {
  const source = model();
  source.source.graph.nodes = [null] as unknown as typeof source.source.graph.nodes;
  expect(validateSourceGraph(source.source.graph)).not.toEqual([]);
  source.source.graph.nodes = [
    { ...model().source.graph.nodes[0]!, domain: null },
  ] as unknown as typeof source.source.graph.nodes;
  expect(projectProperty(source, LOCAL_NATIVE_PROPERTY_PROFILE, context).outcome).toBe('unsupported');
});
