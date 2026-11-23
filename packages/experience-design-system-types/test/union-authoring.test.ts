import { expect, it } from 'vitest';
import { cloneJson } from '../src/property-contract/json-value.js';
import {
  projectProperty,
  LOCAL_NATIVE_PROPERTY_PROFILE,
  type PropertyModel,
  type SourceGraphNode,
} from '../src/property-contract/property-model.js';
import {
  deriveEditableRepresentationPlans,
  validateRepresentationPlan,
} from '../src/property-contract/representation-plan.js';
import { normalizeClassificationCalls } from '../src/property-contract/decision-protocol.js';
import { authoringSourceGraph } from '../src/property-contract/union-authoring.js';

function fixture() {
  const node = (id: string, kind: string, extras: Partial<SourceGraphNode> = {}): SourceGraphNode => ({
    id,
    kind,
    keyPath: ['value'],
    typeText: kind,
    required: true,
    domain: { openness: 'unknown', declaredValues: [], provenance: 'compiler' },
    coverage: 'complete-within-declared-bound',
    reason: null,
    ...extras,
  });
  const judgment = {
    sourceNodeId: 'choice',
    editableNodeId: 'text',
    applicationNodeIds: ['instance'],
    sourceUseRefs: ['output'],
    reason:
      'The consumer accepts text directly. The other alternative is supplied by an application factory, whose instance cannot be authored as a plain record.',
  };
  const model: PropertyModel & { unionAuthoring: (typeof judgment)[] } = {
    identity: { componentId: 'surface', propertyId: 'value', key: 'value', sourceRevision: 'revision', nodeId: 'root' },
    source: {
      typeText: '{ text: string | RuntimeValue }',
      shape: null,
      observations: [],
      useEvidence: [{ reference: 'output', status: 'output-flow-found' }],
      graph: {
        schemaVersion: 1,
        rootId: 'root',
        coverage: 'complete-within-declared-bound',
        omittedCount: 0,
        limits: { maxDepth: 10, maxNodes: 20, maxFields: 10 },
        nodes: [
          node('root', 'record', { fields: [{ key: 'text', nodeId: 'choice', required: true }] }),
          node('choice', 'union', { alternatives: ['text', 'instance'] }),
          node('text', 'string', { domain: { openness: 'open', declaredValues: [], provenance: 'compiler' } }),
          node('instance', 'record', { fields: [], reason: 'empty-record' }),
        ],
      },
    },
    category: 'content',
    defaultIntent: { action: 'absent' },
    unionAuthoring: [judgment],
  };
  return { model, judgment };
}

it('derives an editable model while retaining every application branch and the original source graph', () => {
  const { model } = fixture();
  const original = cloneJson(model);
  const plan = deriveEditableRepresentationPlans(model).find((plan) => plan.kind === 'component-model')!;
  expect(plan.sdkValid, JSON.stringify(plan.issues)).toBe(true);
  expect(plan.models.flatMap((item) => Object.values(item.entry.$properties))).toContainEqual(
    expect.objectContaining({ $type: 'string' }),
  );
  expect(plan.mappings.find((mapping) => mapping.sourceNodeId === 'instance')).toMatchObject({
    disposition: 'application',
  });
  expect(plan.sourceModel.source.graph).toEqual(original.source.graph);
  expect(model).toEqual(original);
  expect(validateRepresentationPlan(plan, model)).toEqual([]);
});

it('validates the authored branch without interpreting the application branch as editable data', () => {
  const { model } = fixture();
  model.category = 'design';
  model.representation = {
    $type: 'record',
    $category: 'design',
    $required: true,
    $fields: { text: { $type: 'string', $required: true } },
  };
  const projection = projectProperty(model, LOCAL_NATIVE_PROPERTY_PROFILE, {
    capabilities: { ':mapper': 'enabled', '/fields/text:mapper': 'enabled' },
  });
  expect(projection.outcome, JSON.stringify(projection.issues)).toBe('lossy');
  expect(projection.model.source.graph.nodes).toHaveLength(4);
});

it('preserves source defaults and refuses a default outside the authored branch', () => {
  const { model } = fixture();
  model.defaultIntent = { action: 'set', value: { text: {} } };
  const plan = deriveEditableRepresentationPlans(model).find((plan) => plan.kind === 'component-model')!;
  expect(plan.sdkValid).toBe(false);
  expect(plan.issues.length).toBeGreaterThan(0);
});

it('does not allow the selected branch to lose finite values or required fields', () => {
  const { model } = fixture();
  model.category = 'design';
  model.source.graph.nodes[2]!.domain = {
    openness: 'closed',
    declaredValues: ['first', 'second'],
    provenance: 'compiler',
  };
  model.representation = {
    $type: 'record',
    $category: 'design',
    $required: true,
    $fields: { text: { $type: 'string', $required: true, $values: ['first'] } },
  };
  const context = { capabilities: { ':mapper': 'enabled', '/fields/text:mapper': 'enabled' } } as const;
  expect(projectProperty(model, LOCAL_NATIVE_PROPERTY_PROFILE, context).outcome).toBe('unsupported');
  model.representation.$fields!.text!.$values = ['first', 'second'];
  expect(projectProperty(model, LOCAL_NATIVE_PROPERTY_PROFILE, context).outcome).toBe('lossy');
  delete model.representation.$fields!.text;
  expect(projectProperty(model, LOCAL_NATIVE_PROPERTY_PROFILE, context).outcome).toBe('unsupported');
});

it('keeps application-only coverage gaps in source evidence without claiming to edit that branch', () => {
  const { model } = fixture();
  model.source.graph.nodes[3]!.kind = 'function';
  model.source.graph.nodes[3]!.coverage = 'partial';
  model.source.graph.nodes[3]!.reason = 'callable-source-kind';
  model.source.graph.nodes[3]!.callSignatures = ['() => string'];
  model.source.graph.coverage = 'partial';
  model.source.graph.omittedCount = 1;
  const plan = deriveEditableRepresentationPlans(model).find((plan) => plan.kind === 'component-model')!;
  expect(plan.sdkValid, JSON.stringify(plan.issues)).toBe(true);
  expect(plan.sourceModel.source.graph).toMatchObject({ coverage: 'partial', omittedCount: 1 });
  expect(plan.mappings.find((mapping) => mapping.sourceNodeId === 'instance')).toMatchObject({
    disposition: 'application',
  });
});

it('preserves null alternatives and shared union references in the authoring view', () => {
  const { model } = fixture();
  model.source.graph.nodes[0]!.fields!.push({ key: 'otherText', nodeId: 'choice', required: true });
  model.source.graph.nodes[1]!.alternatives!.push('nil');
  model.source.graph.nodes[1]!.nullable = true;
  model.source.graph.nodes.push({
    ...cloneJson(model.source.graph.nodes[2]!),
    id: 'nil',
    kind: 'null',
    typeText: 'null',
  });
  const view = authoringSourceGraph(model);
  expect(view.nodes.find((node) => node.id === 'choice')).toMatchObject({
    alternatives: ['text', 'nil'],
    nullable: true,
  });
  expect(view.nodes[0]!.fields).toHaveLength(2);
  expect(model.source.graph.nodes.find((node) => node.id === 'choice')!.alternatives).toEqual([
    'text',
    'instance',
    'nil',
  ]);
  const plan = deriveEditableRepresentationPlans(model).find((plan) => plan.kind === 'component-model')!;
  expect(plan.sdkValid, JSON.stringify(plan.issues)).toBe(true);
  expect(plan.logicalGraph.nodes.some((node) => node.sourceNodeId === 'instance')).toBe(true);
  expect(validateRepresentationPlan(plan, model)).toEqual([]);
});

it.each(['stale-node', 'missing-evidence', 'editable-alternative', 'editable-dictionary', 'editable-empty-tuple'])(
  'rejects an unjustified union authoring projection: %s',
  (mode) => {
    const { model } = fixture();
    if (mode === 'stale-node') model.unionAuthoring[0]!.editableNodeId = 'old-text';
    if (mode === 'missing-evidence') model.unionAuthoring[0]!.sourceUseRefs = ['invented'];
    if (mode === 'editable-alternative') {
      model.source.graph.nodes[3]!.kind = 'number';
      delete model.source.graph.nodes[3]!.fields;
    }
    if (mode === 'editable-dictionary')
      model.source.graph.nodes[3]!.indexSignatures = [{ keyType: 'string', valueNodeId: 'text' }];
    if (mode === 'editable-empty-tuple') {
      model.source.graph.nodes[3]!.kind = 'tuple';
      model.source.graph.nodes[3]!.items = [];
      model.source.graph.nodes[3]!.tupleElements = [];
      delete model.source.graph.nodes[3]!.fields;
    }
    expect(() => deriveEditableRepresentationPlans(model)).toThrow();
  },
);

it('carries the source-bound judgment through the generation protocol', () => {
  const { judgment } = fixture();
  const call = {
    tool: 'classify_prop',
    prop: 'value',
    cdf_category: 'content',
    cdf_type: 'string',
    source_revision: 'revision',
    source_node_id: 'root',
    union_authoring: [judgment],
  };
  expect(normalizeClassificationCalls([call])).toEqual({ calls: [call], warnings: [] });
});
