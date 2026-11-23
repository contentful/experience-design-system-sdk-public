import { describe, expect, it } from 'vitest';
import {
  attachComponentModelPlan,
  buildCDF,
  buildFilteredCDF,
  CDF_SCHEMA_URL,
  cloneJson,
  deriveEditableRepresentationPlans,
  parseCDFComponents,
  validateCDF,
  type CDFComponentEntry,
  type PropertyModel,
  type SourceInputAssociation,
} from '../src/index.js';
import { expandCDFModelDependencies } from '../src/cdf/build.js';

function modelFamily() {
  const node = (id: string, kind: string) => ({
    id,
    kind,
    typeText: kind,
    keyPath: ['settings', id],
    required: true,
    nullable: false,
    undefinable: false,
    domain: { openness: 'open' as const, declaredValues: [], provenance: 'compiler' as const },
    coverage: 'complete-within-declared-bound' as const,
    reason: null,
  });
  const source: PropertyModel = {
    identity: {
      componentId: 'example',
      propertyId: '["example","settings"]',
      key: 'settings',
      sourceRevision: 'revision',
      nodeId: 'root',
    },
    source: {
      typeText: '{ label: string; detail: { flag: boolean; parent?: Settings } }',
      shape: null,
      observations: [],
      graph: {
        schemaVersion: 1,
        rootId: 'root',
        nodes: [
          {
            ...node('root', 'record'),
            fields: [
              { key: 'label', nodeId: 'label', required: true },
              { key: 'detail', nodeId: 'detail', required: true },
            ],
          },
          node('label', 'string'),
          {
            ...node('detail', 'record'),
            fields: [
              { key: 'flag', nodeId: 'flag', required: true },
              { key: 'parent', nodeId: 'parent', required: false },
            ],
          },
          node('flag', 'boolean'),
          { ...node('parent', 'reference'), required: false, alternatives: ['root'] },
        ],
        coverage: 'complete-within-declared-bound',
        limits: { maxDepth: 16, maxNodes: 512, maxFields: 2048 },
        omittedCount: 0,
      },
    },
    category: 'content',
    defaultIntent: { action: 'absent' },
  };
  const plan = deriveEditableRepresentationPlans(source).find((candidate) => candidate.kind === 'component-model')!;
  const owner = { key: 'Example', entry: attachComponentModelPlan({ $type: 'component', $properties: {} }, plan) };
  return { owner, components: expandCDFModelDependencies([owner]), plan };
}

const input = (name: string): SourceInputAssociation => ({
  schemaVersion: 1,
  componentId: 'example',
  componentDeclarationId: 'declaration',
  rootSymbolId: 'inputs',
  inputName: name,
  inputPath: [name],
});

describe('CDF export boundary', () => {
  it('exports definitions and bindings without copying source plans or input evidence', () => {
    const { owner, components } = modelFamily();
    owner.entry.$properties.caption = {
      $type: 'string',
      $category: 'content',
      $required: false,
      $default: '',
      $sourceInput: input('caption'),
    };
    owner.entry.$slots!.children = { $required: false, $sourceInput: input('children') };
    const before = cloneJson(components);
    const document = buildCDF(components, [])!;
    const exported = parseCDFComponents(document).components;

    expect(exported.map(({ key }) => key)).toEqual(components.map(({ key }) => key));
    for (const { entry } of exported) {
      expect(Object.hasOwn(entry, '$representationPlans')).toBe(false);
      for (const property of Object.values(entry.$properties)) expect(property).not.toHaveProperty('$sourceInput');
      for (const slot of Object.values(entry.$slots ?? {})) expect(slot).not.toHaveProperty('$sourceInput');
    }
    expect((document.Example as CDFComponentEntry).$properties.caption).toEqual({
      $type: 'string',
      $category: 'content',
      $required: false,
      $default: '',
    });
    expect((document.Example as CDFComponentEntry).$slots!.settings).toMatchObject({
      $modelBinding: {
        planId: owner.entry.$slots!.settings!.$modelBinding!.planId,
        componentId: 'example',
        propertyId: '["example","settings"]',
        nodeId: 'root',
      },
      $cardinality: owner.entry.$slots!.settings!.$cardinality,
    });
    expect((document.Example as CDFComponentEntry).$slots!.settings!.$modelBinding).not.toHaveProperty('sourceNodeId');
    expect(components).toEqual(before);
    expect(validateCDF(JSON.parse(JSON.stringify(document))).valid).toBe(true);
  });

  it('preserves token definitions, bindings and metadata-looking content values', () => {
    const entry: CDFComponentEntry = {
      $type: 'component',
      $properties: {
        color: {
          $type: 'token',
          $category: 'design',
          '$token.kind': 'color',
          '$token.allowed': ['color.primary'],
          $default: 'color.primary',
        },
        data: {
          $type: 'record',
          $category: 'content',
          $fields: { $representationPlans: { $type: 'string' }, sourceModel: { $type: 'number' } },
          $default: { $representationPlans: 'content', sourceModel: 0 },
        },
        enabled: { $type: 'boolean', $category: 'content', $values: [false, true], $default: false },
      },
    };
    const token = { path: 'color.primary', entry: { $type: 'color' as const, $value: '#000000' } };
    const document = buildCDF([{ key: 'Example', entry }], [token])!;
    expect(document.Example).toEqual(entry);
    expect(document.color).toEqual({ primary: token.entry });
    expect(validateCDF(document).valid).toBe(true);
  });

  it('filters an exported owner with its complete recursive model family', () => {
    const { owner, components } = modelFamily();
    const full = buildCDF([...components, { key: 'Other', entry: { $type: 'component', $properties: {} } }], [])!;
    const filtered = buildFilteredCDF(full, new Set([owner.key]), new Set())!;
    expect(filtered).toEqual(buildCDF(components, []));
    expect(Object.hasOwn(filtered.Example as object, '$representationPlans')).toBe(false);
    expect(validateCDF(filtered).valid).toBe(true);
  });

  it('removes evidence when filtering an older source-bearing document', () => {
    const { components } = modelFamily();
    const legacy = {
      $schema: CDF_SCHEMA_URL as typeof CDF_SCHEMA_URL,
      ...Object.fromEntries(components.map(({ key, entry }) => [key, entry])),
    };
    const filtered = buildFilteredCDF(legacy, new Set(['Example']), new Set())!;
    expect(filtered).toEqual(buildCDF(components, []));
    expect(Object.hasOwn(filtered.Example as object, '$representationPlans')).toBe(false);
  });

  it('validates creation bindings without requiring source evidence in the document', () => {
    const { components } = modelFamily();
    const exported = cloneJson(components);
    for (const { entry } of exported) delete entry.$representationPlans;
    const document = { $schema: CDF_SCHEMA_URL, ...Object.fromEntries(exported.map(({ key, entry }) => [key, entry])) };
    expect(validateCDF(document).valid).toBe(true);
  });

  it.each(['missing-model', 'missing-owner', 'wrong-binding', 'duplicate-attachment'])(
    'rejects a compact document with %s',
    (change) => {
      const { components } = modelFamily();
      const document = buildCDF(components, [])!;
      const rows = parseCDFComponents(document).components;
      const model = rows.find(({ entry }) => entry.$model)!;
      if (change === 'missing-model') delete document[model.key];
      if (change === 'missing-owner') delete document.Example;
      if (change === 'wrong-binding') model.entry.$model!.planId = 'different-plan';
      if (change === 'duplicate-attachment') {
        const owner = document.Example as CDFComponentEntry;
        owner.$slots!.other = cloneJson(owner.$slots!.settings!);
      }
      expect(validateCDF(document).valid).toBe(false);
    },
  );

  it('rejects altered source plans before removing evidence', () => {
    const { owner } = modelFamily();
    owner.entry.$representationPlans!.settings!.sourceModel.identity.sourceRevision = 'changed';
    expect(() => buildCDF([owner], [])).toThrow(/Invalid CDF/);
  });
});
