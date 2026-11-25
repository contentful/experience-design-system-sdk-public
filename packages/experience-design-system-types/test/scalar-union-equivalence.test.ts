import { expect, it } from 'vitest';
import { normalizeClassificationCalls } from '../src/property-contract/decision-protocol.js';
import {
  LOCAL_NATIVE_PROPERTY_PROFILE,
  projectProperty,
  type PropertyModel,
  type SourceGraphNode,
} from '../src/property-contract/property-model.js';
import { authoringSourceGraph, validateUnionAuthoringSource } from '../src/property-contract/union-authoring.js';
import {
  attachComponentModelPlan,
  deriveEditableRepresentationPlans,
  validateRepresentationPlan,
} from '../src/property-contract/representation-plan.js';
import { buildCDF, validateCDF } from '../src/cdf/index.js';

function fixture() {
  const scalar = (id: string, kind: string, value: boolean | string): SourceGraphNode => ({
    id,
    kind,
    keyPath: ['announcement'],
    typeText: JSON.stringify(value),
    required: false,
    domain: { openness: 'closed', declaredValues: [value], provenance: 'compiler' },
    coverage: 'complete-within-declared-bound',
    reason: null,
  });
  const judgment = {
    sourceNodeId: 'choice',
    editableNodeId: 'false',
    applicationNodeIds: [],
    sourceUseRefs: ['attribute-output'],
    equivalentAlternatives: [
      { nodeId: 'false-text', editableNodeId: 'false' },
      { nodeId: 'true-text', editableNodeId: 'true' },
    ],
    reason:
      'The verified consumer serializes the value as an attribute; false and "false", and true and "true", have the same output and no intervening comparisons distinguish them.',
  };
  const model: PropertyModel = {
    identity: {
      componentId: 'surface',
      propertyId: JSON.stringify(['surface', 'announcement']),
      key: 'announcement',
      sourceRevision: 'revision',
      nodeId: 'choice',
    },
    source: {
      typeText: 'false | true | "false" | "true"',
      shape: null,
      observations: [],
      useEvidence: [{ reference: 'attribute-output', status: 'output-flow-found' }],
      graph: {
        schemaVersion: 1,
        rootId: 'choice',
        coverage: 'complete-within-declared-bound',
        omittedCount: 0,
        resources: { nodes: 5, edges: 4 },
        limits: { maxDepth: 10, maxNodes: 20, maxFields: 10 },
        nodes: [
          {
            ...scalar('choice', 'union', false),
            alternatives: ['false', 'true', 'false-text', 'true-text'],
            domain: { openness: 'closed', declaredValues: [false, true, 'false', 'true'], provenance: 'compiler' },
          },
          scalar('false', 'boolean', false),
          scalar('true', 'boolean', true),
          scalar('false-text', 'string', 'false'),
          scalar('true-text', 'string', 'true'),
        ],
      },
    },
    category: 'design',
    defaultIntent: { action: 'absent' },
    unionAuthoring: [judgment],
    representation: { $type: 'boolean', $category: 'design', $required: false, $values: [false, true] },
  };
  return { model, judgment };
}

it('represents evidenced equivalent scalar alternatives as Boolean without changing source evidence', () => {
  const { model } = fixture();
  const original = structuredClone(model);
  expect(validateUnionAuthoringSource(model.unionAuthoring, model)).toEqual([]);
  const view = authoringSourceGraph(model);
  expect(view.nodes[0]).toMatchObject({ alternatives: ['false', 'true'], domain: { declaredValues: [false, true] } });
  expect(view.resources).toEqual({ nodes: 3, edges: 2 });
  expect(
    projectProperty(model, LOCAL_NATIVE_PROPERTY_PROFILE, { capabilities: { ':mapper': 'enabled' } }).outcome,
  ).toBe('lossy');
  const plan = deriveEditableRepresentationPlans(model).find((plan) => plan.kind === 'native')!;
  expect(plan.sdkValid, JSON.stringify(plan.issues)).toBe(true);
  expect(plan.mappings.filter((mapping) => mapping.sourceNodeId.endsWith('-text'))).toEqual([
    expect.objectContaining({ disposition: 'reference', targetNodeId: expect.any(String) }),
    expect.objectContaining({ disposition: 'reference', targetNodeId: expect.any(String) }),
  ]);
  expect(validateRepresentationPlan(plan, model)).toEqual([]);
  expect(model).toEqual(original);
});

it.each([
  'missing-evidence',
  'stale-node',
  'different-value',
  'missing-alternative',
  'partial',
  'open-domain',
  'duplicate-target',
  'non-boolean',
])('rejects unproven or incomplete scalar equivalence: %s', (mode) => {
  const { model, judgment } = fixture();
  if (mode === 'missing-evidence') judgment.sourceUseRefs = ['invented'];
  if (mode === 'stale-node') judgment.equivalentAlternatives[0]!.nodeId = 'old-node';
  if (mode === 'different-value') model.source.graph.nodes[3]!.domain.declaredValues = ['different'];
  if (mode === 'missing-alternative') judgment.equivalentAlternatives.pop();
  if (mode === 'partial') model.source.graph.nodes[3]!.coverage = 'partial';
  if (mode === 'open-domain') model.source.graph.nodes[3]!.domain.openness = 'open';
  if (mode === 'duplicate-target') judgment.equivalentAlternatives[1]!.editableNodeId = 'false';
  if (mode === 'non-boolean') model.source.graph.nodes[1]!.kind = 'number';
  expect(validateUnionAuthoringSource(model.unionAuthoring, model).length).toBeGreaterThan(0);
});

it('still rejects unjudged narrowing and loss of a Boolean choice', () => {
  const { model } = fixture();
  model.representation!.$values = [true];
  expect(
    projectProperty(model, LOCAL_NATIVE_PROPERTY_PROFILE, { capabilities: { ':mapper': 'enabled' } }).outcome,
  ).toBe('unsupported');
  delete model.unionAuthoring;
  model.representation!.$values = [false, true];
  expect(
    projectProperty(model, LOCAL_NATIVE_PROPERTY_PROFILE, { capabilities: { ':mapper': 'enabled' } }).outcome,
  ).toBe('unsupported');
});

it('accepts the equivalence judgment in generation', () => {
  const { judgment } = fixture();
  const call = {
    tool: 'classify_prop',
    prop: 'announcement',
    cdf_category: 'design',
    cdf_type: 'boolean',
    values: [false, true],
    source_revision: 'revision',
    source_node_id: 'choice',
    union_authoring: [judgment],
  };
  expect(normalizeClassificationCalls([call])).toEqual({ calls: [call], warnings: [] });
});

it('preserves meaningfully distinct scalar alternatives through a model Component with an exclusive variant slot', () => {
  const { model } = fixture();
  delete model.unionAuthoring;
  delete model.representation;
  model.category = 'content';
  const plan = deriveEditableRepresentationPlans(model).find((candidate) => candidate.kind === 'component-model')!;
  expect(plan.sdkValid, JSON.stringify(plan.issues)).toBe(true);
  const wrapper = plan.models.find((generated) => generated.nodeId === plan.logicalGraph.rootId)!;
  expect(wrapper.entry.$slots!.variant).toMatchObject({ $cardinality: { min: 1, max: 1, ordered: false } });
  expect(wrapper.entry.$slots!.variant!.$allowedComponents).toHaveLength(4);
  expect(plan.mappings.filter((mapping) => mapping.variant)).toHaveLength(4);
  expect(
    plan.models.flatMap((generated) => Object.values(generated.entry.$properties).map((property) => property.$type)),
  ).toEqual(expect.arrayContaining(['boolean', 'string']));
  expect(plan.sourceModel.source.graph).toEqual(model.source.graph);
  expect(plan.requirements).toContainEqual(expect.objectContaining({ capability: 'exclusive-union-branch-selection' }));
  expect(validateRepresentationPlan(plan, model)).toEqual([]);
  const entry = attachComponentModelPlan({ $type: 'component', $properties: {} }, plan);
  expect(validateCDF(buildCDF([{ key: 'Surface', entry }], [])!)).toMatchObject({ valid: true });
  const altered = structuredClone(plan);
  altered.models.find((generated) => generated.entry.$slots?.variant)!.entry.$slots!.variant!.$allowedComponents!.pop();
  expect(validateRepresentationPlan(altered, model).length).toBeGreaterThan(0);
});

it('keeps a scalar variant model incomplete when an alternative has unavailable source semantics', () => {
  const { model } = fixture();
  delete model.unionAuthoring;
  delete model.representation;
  model.source.graph.nodes[3]!.kind = 'unknown';
  model.source.graph.nodes[3]!.coverage = 'partial';
  model.source.graph.nodes[3]!.reason = 'source-unavailable';
  model.source.graph.coverage = 'partial';
  model.source.graph.omittedCount = 1;
  const plan = deriveEditableRepresentationPlans(model).find((candidate) => candidate.kind === 'component-model')!;
  expect(plan.sdkValid).toBe(false);
  expect(plan.mappings.some((mapping) => mapping.disposition === 'held')).toBe(true);
});
