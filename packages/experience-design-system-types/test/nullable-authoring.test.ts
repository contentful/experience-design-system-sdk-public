import { expect, it } from 'vitest';
import {
  deriveEditableRepresentationPlans,
  validateRepresentationPlan,
  validateSourceGraph,
  deriveRepresentationAlternatives,
  projectSourceDefault,
  reconstructAuthoringValue,
  validateSourceValue,
  validateRepresentationProposalSource,
  SAME_SPACE_RESOURCE_SOURCE,
  cdfToTarget,
  validateDiscriminatedUnionSourceDefinition,
  type PropertyModel,
  type SourceGraphNode,
} from '../src/index.js';

function node(kind: string, id = 'value', nullable = true): SourceGraphNode {
  return {
    id,
    kind,
    keyPath: [id],
    typeText: kind,
    required: true,
    nullable,
    undefinable: false,
    nullability: {
      compilerMode: 'enabled',
      null: { state: nullable ? 'present' : 'absent', source: 'compiler' },
      undefined: { state: 'absent', source: 'compiler' },
    },
    domain: { openness: 'open', declaredValues: [], provenance: 'compiler' },
    coverage: 'complete-within-declared-bound',
    reason: null,
  };
}

function model(root: SourceGraphNode, children: SourceGraphNode[] = []): PropertyModel {
  return {
    identity: {
      componentId: 'Example',
      propertyId: 'value',
      key: 'value',
      sourceRevision: 'revision',
      nodeId: root.id,
    },
    source: {
      typeText: root.typeText,
      shape: null,
      observations: [],
      graph: {
        schemaVersion: 1,
        rootId: root.id,
        nodes: [root, ...children],
        coverage: 'complete-within-declared-bound',
        omittedCount: 0,
        limits: { maxDepth: 16, maxNodes: 512, maxFields: 4096 },
      },
    },
    category: 'content',
    defaultIntent: { action: 'absent' },
  };
}

it.each(['string', 'number', 'boolean', 'record', 'array'])(
  'projects required nullable %s as optional without changing source facts',
  (kind) => {
    const root = node(kind);
    const child = node('string', 'child', false);
    if (kind === 'record') root.fields = [{ key: 'child', nodeId: child.id, required: true }];
    if (kind === 'array') root.items = [child.id];
    const input = model(root, ['record', 'array'].includes(kind) ? [child] : []);
    const before = structuredClone(input);
    expect(validateSourceGraph(input.source.graph)).toEqual([]);
    const plan = deriveEditableRepresentationPlans(input).find((entry) => entry.kind === 'native');
    expect(plan?.sdkValid).toBe(true);
    expect(plan?.nativeDefinition).toMatchObject({ $type: kind, $required: false });
    expect(plan?.mappings[0]).toMatchObject({
      required: true,
      nullable: true,
      authoringPresence: { required: false, unset: 'null' },
    });
    expect(validateRepresentationPlan(plan, input)).toEqual([]);
    expect(input).toEqual(before);
  },
);

it('keeps a nullable nested field optional within a required record', () => {
  const root = node('record', 'value', false);
  root.fields = [{ key: 'label', nodeId: 'label', required: true }];
  const plan = deriveEditableRepresentationPlans(model(root, [node('string', 'label')])).find(
    (entry) => entry.kind === 'native',
  );
  expect(plan?.nativeDefinition).toMatchObject({
    $required: true,
    $fields: { label: { $type: 'string', $required: false } },
  });
});

it('retains null defaults as source facts without emitting a scalar null default', () => {
  const input = model(node('boolean'));
  input.source.default = { expression: 'null', state: 'value', value: null };
  const plan = deriveEditableRepresentationPlans(input).find((entry) => entry.kind === 'native');
  expect(plan?.sdkValid).toBe(true);
  expect(plan?.nativeDefinition).not.toHaveProperty('$default');
  expect(plan?.sourceDefault).toMatchObject({ value: null });
});

it('preserves finite non-null choices while making the field optional', () => {
  const root = node('string');
  root.domain = { openness: 'closed', provenance: 'compiler', declaredValues: ['small', 'large', null] };
  const plan = deriveEditableRepresentationPlans(model(root)).find((entry) => entry.kind === 'native');
  expect(plan?.nativeDefinition).toMatchObject({ $required: false, $values: ['small', 'large'] });
});

it('does not infer nullability from disabled compiler checks or emit redundant Boolean choices', () => {
  const root = node('boolean', 'value', false);
  delete root.nullable;
  delete root.undefinable;
  root.nullability = {
    compilerMode: 'disabled',
    null: { state: 'unknown', source: 'compiler-erased' },
    undefined: { state: 'unknown', source: 'compiler-erased' },
  };
  root.domain = { openness: 'closed', declaredValues: [false, true], provenance: 'compiler' };
  const plan = deriveEditableRepresentationPlans(model(root)).find((entry) => entry.kind === 'native');
  expect(plan?.nativeDefinition).toMatchObject({ $type: 'boolean', $required: true });
  expect(plan?.nativeDefinition).not.toHaveProperty('$values');
});

it('preserves a singleton Boolean constraint and a non-null default', () => {
  const root = node('boolean');
  root.domain = { openness: 'closed', declaredValues: [true, null], provenance: 'compiler' };
  const input = model(root);
  input.source.default = { expression: 'true', state: 'value', value: true };
  const plan = deriveEditableRepresentationPlans(input).find((entry) => entry.kind === 'native');
  expect(plan?.nativeDefinition).toMatchObject({ $required: false, $values: [true], $default: true });
});

it('records nullable array element positions instead of deleting them', () => {
  const root = node('array', 'value', false);
  root.items = ['child'];
  const input = model(root, [node('string', 'child')]);
  const plan = deriveEditableRepresentationPlans(input).find((entry) => entry.kind === 'native');
  expect(plan?.nativeDefinition?.$items).toMatchObject({ $type: 'string', $required: false });
  expect(plan?.mappings.find((entry) => entry.sourceNodeId === 'child')).toMatchObject({
    authoringPresence: { required: false, unset: 'null', preservesPosition: true },
  });
});

it('makes a required nullable model attachment optional and retains its source key contract', () => {
  const root = node('record');
  root.fields = [{ key: 'nested', nodeId: 'nested', required: true }];
  const nested = node('record', 'nested');
  nested.fields = [{ key: 'label', nodeId: 'label', required: true }];
  const input = model(root, [nested, node('string', 'label')]);
  const plan = deriveEditableRepresentationPlans(input).find((entry) => entry.kind === 'component-model');
  expect(plan?.sdkValid).toBe(true);
  expect(plan?.attachment?.definition).toMatchObject({ $required: false, $cardinality: { min: 0 } });
  expect(plan?.mappings[0]).toMatchObject({ required: true, authoringPresence: { required: false, unset: 'null' } });
  expect(validateRepresentationPlan(plan, input)).toEqual([]);
});

it('projects nested null defaults as unset fields while retaining the complete source default', () => {
  const root = node('record', 'value', false);
  root.fields = [
    { key: 'label', nodeId: 'label', required: true },
    { key: 'count', nodeId: 'count', required: true },
  ];
  const input = model(root, [node('string', 'label'), node('number', 'count', false)]);
  input.source.default = { expression: 'sourceDefault', state: 'value', value: { label: null, count: 3 } };
  const plan = deriveEditableRepresentationPlans(input).find((entry) => entry.kind === 'native');
  expect(plan?.sdkValid).toBe(true);
  expect(plan?.nativeDefinition?.$default).toEqual({ count: 3 });
  expect(plan?.sourceDefault?.value).toEqual({ label: null, count: 3 });
  expect(plan?.requirements).toContainEqual({ path: '/', capability: 'source-structural-default-materialization' });
});

it('validates an explicitly projected default against its reconstructed source contract', () => {
  const root = node('record', 'value', false);
  root.fields = [
    { key: 'label', nodeId: 'label', required: true },
    { key: 'count', nodeId: 'count', required: true },
  ];
  const input = model(root, [node('string', 'label'), node('number', 'count', false)]);
  input.source.default = { expression: 'sourceDefault', state: 'value', value: { label: null, count: 3 } };
  input.defaultIntent = { action: 'set', value: { count: 3 } };
  const plan = deriveEditableRepresentationPlans(input).find((entry) => entry.kind === 'native');
  expect(plan?.sdkValid, JSON.stringify(plan?.issues)).toBe(true);
  expect(plan?.nativeDefinition?.$default).toEqual({ count: 3 });
  expect(validateRepresentationPlan(plan, input)).toEqual([]);
});

it('retains an array default with null elements in reconstruction rather than removing positions', () => {
  const root = node('array', 'value', false);
  root.items = ['child'];
  const input = model(root, [node('string', 'child')]);
  input.source.default = { expression: 'sourceDefault', state: 'value', value: [null, 'label'] };
  const plan = deriveEditableRepresentationPlans(input).find((entry) => entry.kind === 'native');
  expect(plan?.sdkValid).toBe(true);
  expect(plan?.nativeDefinition).not.toHaveProperty('$default');
  expect(plan?.sourceDefault?.value).toEqual([null, 'label']);
  expect(plan?.requirements).toContainEqual({ path: '/', capability: 'source-structural-default-materialization' });
});

it('keeps source defaults reconstructable through multiple non-null union branches', () => {
  const root = node('union', 'value', false);
  root.alternatives = ['first', 'second'];
  const first = node('record', 'first', false);
  const second = node('record', 'second', false);
  first.fields = [
    { key: 'label', nodeId: 'label', required: true },
    { key: 'count', nodeId: 'count', required: true },
  ];
  second.fields = [{ key: 'other', nodeId: 'other', required: true }];
  const input = model(root, [
    first,
    second,
    node('string', 'label'),
    node('number', 'count', false),
    node('boolean', 'other', false),
  ]);
  const original = { label: null, count: 3 };
  const projected = projectSourceDefault(input.source.graph, original)!;
  expect(projected).toEqual({ count: 3 });
  const reconstructed = reconstructAuthoringValue(input.source.graph, projected);
  expect(reconstructed).toEqual(original);
  expect(validateSourceValue(input.source.graph, reconstructed)).toEqual([]);
});

it('reconstructs nullable own keys without changing the object prototype', () => {
  const root = node('record', 'value', false);
  root.fields = [{ key: '__proto__', nodeId: 'child', required: true }];
  const input = model(root, [node('string', 'child')]);
  const reconstructed = reconstructAuthoringValue(input.source.graph, {});
  if (!reconstructed || typeof reconstructed !== 'object') throw new Error('Expected reconstructed record');
  expect(Object.getPrototypeOf(reconstructed)).toBe(Object.prototype);
  expect(Object.hasOwn(reconstructed, '__proto__')).toBe(true);
  expect(JSON.stringify(reconstructed)).toBe('{"__proto__":null}');
});

it('keeps defaults with ambiguous projected union identity entirely in source reconstruction', () => {
  const root = node('union', 'value', false);
  root.alternatives = ['first', 'second'];
  const first = node('record', 'first', false);
  const second = node('record', 'second', false);
  first.fields = [{ key: 'label', nodeId: 'label', required: true }];
  second.fields = [{ key: 'other', nodeId: 'other', required: true }];
  const input = model(root, [first, second, node('string', 'label'), node('boolean', 'other')]);
  expect(projectSourceDefault(input.source.graph, { other: null })).toBeUndefined();
});

it('retains a nested collection default when null elements cannot become editor values', () => {
  const root = node('record', 'value', false);
  root.fields = [{ key: 'items', nodeId: 'items', required: true }];
  const items = node('array', 'items', false);
  items.items = ['label'];
  const input = model(root, [items, node('string', 'label')]);
  input.source.default = { expression: 'sourceDefault', state: 'value', value: { items: [null, 'label'] } };
  expect(projectSourceDefault(input.source.graph, input.source.default.value!)).toBeUndefined();
  expect(input.source.default.value).toEqual({ items: [null, 'label'] });
});

it('uses authoring optionality in advisory record alternatives', () => {
  const root = node('record', 'value', false);
  root.fields = [{ key: 'label', nodeId: 'label', required: true }];
  const input = model(root, [node('string', 'label')]);
  expect(
    deriveRepresentationAlternatives(input).find((entry) => entry.kind === 'record-component')?.definition,
  ).toMatchObject({ fields: { label: { required: false } } });
});

it('rejects stale policy and forged null reconstruction before admitting a saved plan', () => {
  const input = model(node('string'));
  const plan = deriveEditableRepresentationPlans(input).find((entry) => entry.kind === 'native')!;
  const stale = structuredClone(plan);
  delete (stale as Partial<typeof plan>).authoringPolicy;
  expect(validateRepresentationPlan(stale, input)[0]?.message).toMatch(/Stale authoring presence policy/);
  const forged = structuredClone(plan);
  forged.mappings[0]!.authoringPresence.unset = 'omit';
  expect(validateRepresentationPlan(forged, input)[0]?.message).toMatch(/forged/);
  const wrongRequired = structuredClone(plan);
  wrongRequired.nativeDefinition!.$required = true;
  expect(validateRepresentationPlan(wrongRequired, input)[0]?.message).toMatch(/forged/);
});

it('admits a positively nullable resource representation while preserving its delivery prerequisites', () => {
  const input = model(node('record'));
  input.source.graph.nodes[0]!.fields = [{ key: 'id', nodeId: 'id', required: true }];
  input.source.graph.nodes.push(node('string', 'id', false));
  input.source.useEvidence = [{ reference: 'resource-use', status: 'output-flow-found' }];
  const draft = {
    ...input.identity,
    name: 'Value',
    sourceNodeIds: ['value', 'id'],
    declaredConstraints: [],
    provenConstraints: [],
    observations: [],
    judgment: 'Captured consumer accepts the supplied resource contract.',
    desiredType: 'ResourceLink',
    desiredDefinition: {
      type: 'ResourceLink',
      required: false,
      allowedResources: [{ type: 'Contentful:Entry', source: SAME_SPACE_RESOURCE_SOURCE, allowedTypes: ['example'] }],
    },
    compatibility: {
      status: 'judged-compatible',
      sourceUseRefs: ['resource-use'],
      unresolvedRequirements: ['resource-delivery'],
    },
  };
  delete (draft as Partial<typeof draft>).nodeId;
  expect(validateRepresentationProposalSource(draft, input)).toMatchObject({ valid: true });
  delete input.source.graph.nodes[0]!.nullable;
  input.source.graph.nodes[0]!.nullability!.null = { state: 'unknown', source: 'compiler-erased' };
  expect(validateRepresentationProposalSource(draft, input).valid).toBe(false);
});

it.each(['string', 'boolean'])(
  'models a nullable tagged union with nullable %s fields and explicit null reconstruction',
  (kind) => {
    const root = node('union');
    root.alternatives = ['first', 'second', 'empty'];
    const first = node('record', 'first', false);
    const second = node('record', 'second', false);
    first.fields = [
      { key: 'kind', nodeId: 'firstTag', required: true },
      { key: 'label', nodeId: 'label', required: true },
    ];
    second.fields = [
      { key: 'kind', nodeId: 'secondTag', required: true },
      { key: 'count', nodeId: 'count', required: true },
    ];
    const firstTag = node('string', 'firstTag', false);
    firstTag.domain = { openness: 'closed', declaredValues: ['first'], provenance: 'compiler' };
    const secondTag = node('string', 'secondTag', false);
    secondTag.domain = { openness: 'closed', declaredValues: ['second'], provenance: 'compiler' };
    const empty = node('null', 'empty');
    empty.domain = { openness: 'closed', declaredValues: [null], provenance: 'compiler' };
    const label = node(kind, 'label');
    if (kind === 'boolean') label.domain = { openness: 'closed', declaredValues: [true, null], provenance: 'compiler' };
    const input = model(root, [first, second, firstTag, secondTag, label, node('number', 'count'), empty]);
    input.source.default = { expression: 'sourceDefault', state: 'value', value: { kind: 'first', label: null } };
    const native = deriveEditableRepresentationPlans(input).find((entry) => entry.kind === 'native');
    expect(native?.nativeDefinition?.$default).toEqual({ kind: 'first' });
    expect(
      validateDiscriminatedUnionSourceDefinition(cdfToTarget(native!.nativeDefinition!), input.source.graph),
    ).toEqual([]);
    const plan = deriveEditableRepresentationPlans(input).find((entry) => entry.kind === 'component-model');
    expect(plan?.sdkValid).toBe(true);
    expect(plan?.attachment?.definition).toMatchObject({ $required: false });
    expect(plan?.mappings.find((mapping) => mapping.sourceNodeId === 'empty')).toMatchObject({
      disposition: 'reconstruction',
      reconstruction: { kind: 'empty-value', state: 'null' },
    });
    expect(validateRepresentationPlan(plan, input)).toEqual([]);
  },
);
