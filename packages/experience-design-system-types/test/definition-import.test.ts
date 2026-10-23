import { describe, expect, it } from 'vitest';
import {
  attachComponentModelPlan,
  buildCDF,
  cloneJson,
  componentDefinitionImportIssues,
  componentModelFamilyIssues,
  definitionImportCapabilityStatus,
  deriveEditableRepresentationPlans,
  evaluateRepresentationReadiness,
  parseCDFComponents,
  propertyDefinitionImportBlockers,
  representationDefinitionImportIssues,
  slotDefinitionImportIssues,
  type PropertyModel,
} from '../src/index.js';

function family() {
  const node = (id: string, keyPath: string[], kind: string) => ({
    id,
    keyPath,
    kind,
    typeText: kind,
    required: true,
    nullable: false,
    undefinable: false,
    domain: { openness: 'open' as const, declaredValues: [], provenance: 'compiler' as const },
    coverage: 'complete-within-declared-bound' as const,
    reason: null,
  });
  const model: PropertyModel = {
    identity: {
      componentId: 'example',
      propertyId: '["example","settings"]',
      key: 'settings',
      sourceRevision: 'revision',
      nodeId: 'root',
    },
    source: {
      typeText: '{ label: string; detail: { flag: boolean; title: string } }',
      shape: {
        $type: 'record',
        $fields: {
          label: { $type: 'string' },
          detail: { $type: 'record', $fields: { flag: { $type: 'boolean' }, title: { $type: 'string' } } },
        },
      },
      observations: [],
      graph: {
        schemaVersion: 1,
        rootId: 'root',
        nodes: [
          {
            ...node('root', ['settings'], 'record'),
            fields: [
              { key: 'label', nodeId: 'label', required: true },
              { key: 'detail', nodeId: 'detail', required: true },
            ],
          },
          node('label', ['settings', 'label'], 'string'),
          {
            ...node('detail', ['settings', 'detail'], 'record'),
            fields: [
              { key: 'flag', nodeId: 'flag', required: true },
              { key: 'title', nodeId: 'title', required: true },
            ],
          },
          node('flag', ['settings', 'detail', 'flag'], 'boolean'),
          node('title', ['settings', 'detail', 'title'], 'string'),
        ],
        coverage: 'complete-within-declared-bound',
        limits: { maxDepth: 16, maxNodes: 512, maxFields: 2048 },
        omittedCount: 0,
      },
    },
    category: 'content',
    defaultIntent: { action: 'set', value: { label: 'Example', detail: { flag: false, title: 'Detail' } } },
  };
  const plan = cloneJson(
    deriveEditableRepresentationPlans(model).find((candidate) => candidate.kind === 'component-model')!,
  );
  const document = buildCDF(
    [{ key: 'Example', entry: attachComponentModelPlan({ $type: 'component', $properties: {} }, plan) }],
    [],
  )!;
  return { plan, components: parseCDFComponents(document).components };
}

describe('definition import capability boundary', () => {
  it('retains deferred runtime requirements without certifying rendering readiness', () => {
    const { plan, components } = family();
    expect(plan.sdkValid).toBe(true);
    expect(plan.requirements).toContainEqual({ path: '/', capability: 'source-reconstruction' });
    expect(evaluateRepresentationReadiness(plan).ready).toBe(false);
    expect(representationDefinitionImportIssues(plan)).toEqual([]);
    expect(componentModelFamilyIssues(components)).toEqual([]);
    expect(components.flatMap(({ entry }) => componentDefinitionImportIssues(entry))).toEqual([]);
    expect(definitionImportCapabilityStatus('source-reconstruction')).toBe('deferred');
    expect(definitionImportCapabilityStatus('unknown-capability')).toBe('unavailable');
  });
  it.each(['missing-owner', 'changed-model', 'unowned-slot'])('refuses %s', (change) => {
    const { components } = family();
    if (change === 'missing-owner') components.shift();
    if (change === 'changed-model') components[1]!.entry.$description = 'Changed without plan';
    if (change === 'unowned-slot')
      components[0]!.entry.$slots!.rogue = cloneJson(components[0]!.entry.$slots!.settings!);
    expect(componentModelFamilyIssues(components).length).toBeGreaterThan(0);
  });
  it('refuses unknown capabilities and forged source plans', () => {
    const { components, plan } = family();
    plan.requirements.push({ path: '/', capability: 'unknown-capability' });
    expect(representationDefinitionImportIssues(plan)[0]).toContain('unknown-capability');
    const stored = components[0]!.entry.$representationPlans!.settings!;
    stored.sourceModel.identity.sourceRevision = 'forged';
    expect(componentDefinitionImportIssues(components[0]!.entry).length).toBeGreaterThan(0);
  });
  it('rejects a native plan requiring deferred runtime behavior', () => {
    const { plan } = family();
    plan.kind = 'native';
    expect(representationDefinitionImportIssues(plan).length).toBeGreaterThan(0);
  });
  it('admits finite choices and numeric design while holding structured design', () => {
    expect(propertyDefinitionImportBlockers({ $type: 'number', $category: 'design', $values: [0, 1] })).toEqual([]);
    expect(propertyDefinitionImportBlockers({ $type: 'string', $category: 'content', $values: ['a', 'b'] })).toEqual(
      [],
    );
    expect(
      propertyDefinitionImportBlockers({
        $type: 'record',
        $category: 'design',
        $fields: { label: { $type: 'string' } },
      }).length,
    ).toBe(1);
  });
  it('keeps positional, empty-only and unsafe bounds guarded', () => {
    for (const cardinality of [
      { min: 0, max: 0, ordered: true },
      { min: 0, max: 1, ordered: true, tuplePosition: 0 },
      { min: 0, max: null, ordered: true, rest: true },
      { min: 0, max: Number.MAX_SAFE_INTEGER + 1, ordered: true },
    ])
      expect(slotDefinitionImportIssues({ $cardinality: cardinality }).length).toBe(1);
    expect(slotDefinitionImportIssues({ $cardinality: { min: 2, max: 2, ordered: true } })).toEqual([]);
  });
});
