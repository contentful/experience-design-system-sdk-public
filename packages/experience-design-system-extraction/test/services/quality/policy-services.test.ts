import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { RawComponentDefinition, RawPropDefinition } from '../../../src/extract/types/component.js';
import { preClassifyComponent, preClassifyProp } from '../../../src/extract/services/classification/classify-component-props.js';
import { evaluateExtractionQuality } from '../../../src/extract/services/quality/evaluate-extraction-quality.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function prop(overrides: Partial<RawPropDefinition>): RawPropDefinition {
  return { name: 'label', type: 'string', required: false, ...overrides };
}

function component(overrides: Partial<RawComponentDefinition>): RawComponentDefinition {
  return {
    name: 'Button',
    source: '/tmp/Button.tsx',
    framework: 'react',
    props: [prop({})],
    slots: [],
    ...overrides,
  };
}

describe('classification service', () => {
  it('classifies authorable design props and removes DOM provenance from component output', () => {
    expect(preClassifyProp(prop({ name: 'variant', type: "'solid' | 'ghost'" }))).toEqual({
      category: 'design',
      cdfTypeHint: 'enum',
    });

    const classified = preClassifyComponent(
      component({
        props: [prop({ name: 'name', domAttribute: true }), prop({ name: 'variant', type: "'solid' | 'ghost'" })],
      }),
    );

    expect(classified.props).toEqual([expect.objectContaining({ name: 'variant', category: 'design' })]);
    expect(classified.props.some((candidate) => 'domAttribute' in candidate)).toBe(false);
  });

  it('does not classify unresolved complex props as authorable categories', () => {
    expect(preClassifyProp(prop({ name: 'payload', type: 'Record<string, unknown>' }))).toBeUndefined();
  });
});

describe('quality service', () => {
  it('scores and validates an authorable component without adding review warnings', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'quality-service-valid-'));
    tempDirs.push(projectRoot);
    const source = join(projectRoot, 'Button.tsx');
    await writeFile(
      source,
      'export function Button({ label }: { label: string }) { return <button>{label}</button>; }',
    );

    const result = await evaluateExtractionQuality([component({ source })], []);

    expect(result.components[0]).toEqual(expect.objectContaining({ extractionConfidence: 5, validationIssues: [] }));
    expect(result.warnings).toEqual([]);
  });

  it('retains a zero-surface component for review instead of silently excluding it', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'quality-service-review-'));
    tempDirs.push(projectRoot);
    const source = join(projectRoot, 'Tracker.tsx');
    await writeFile(source, 'export function Tracker() { return null; }');

    const result = await evaluateExtractionQuality([component({ name: 'Tracker', source, props: [], slots: [] })], []);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.needsReview).toBe(true);
    expect(result.components[0]?.validationIssues).toContainEqual(
      expect.objectContaining({ code: 'EMPTY_COMPONENT', severity: 'warning' }),
    );
    expect(result.warnings).toContain('Tracker: requires operator review (component has no props and no slots)');
  });
});
