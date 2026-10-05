import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { RawComponentDefinition, RawPropDefinition } from '../../../src/extract/types/component.js';
import { hasNoAuthoringSurface } from '../../../src/extract/services/quality/helpers/authorability/evaluate-authorability.js';
import { computeExtractionScore, deriveNeedsReview } from '../../../src/extract/services/quality/helpers/scoring/compute-extraction-score.js';
import { inspectComponentSource } from '../../../src/extract/services/quality/helpers/inspection/inspect-component-source.js';
import { validateExtractedComponents } from '../../../src/extract/services/quality/helpers/inspection/validate-extracted-components.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function prop(overrides: Partial<RawPropDefinition> = {}): RawPropDefinition {
  return { name: 'label', type: 'string', required: false, ...overrides };
}

function component(overrides: Partial<RawComponentDefinition> = {}): RawComponentDefinition {
  return {
    name: 'Button',
    source: '/tmp/Button.tsx',
    framework: 'react',
    props: [prop()],
    slots: [],
    ...overrides,
  };
}

describe('quality policy boundaries', () => {
  it('filters components whose entire prop surface is handler or ref plumbing', () => {
    expect(
      hasNoAuthoringSurface(
        component({
          props: [prop({ name: 'onReady', type: '() => void' })],
        }),
      ),
    ).toEqual({ skip: true, reason: 'every prop is a handler or ref' });
  });

  it('scores clear components and derives review thresholds from confidence', () => {
    const score = computeExtractionScore(component());

    expect(score).toEqual({ confidence: 5, reasons: [] });
    expect(deriveNeedsReview(score.confidence)).toBe(false);
    expect(deriveNeedsReview(2)).toBe(true);
  });

  it('reports validation issues without changing extracted component data', () => {
    const extracted = component({
      name: '',
      props: [prop({ name: '' }), prop({ name: 'label' })],
      slots: [{ name: 'label', isDefault: false }],
    });

    const validated = validateExtractedComponents([extracted]);

    expect(validated[0]).toMatchObject(extracted);
    expect(validated[0]?.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'EMPTY_COMPONENT_NAME', severity: 'error' }),
        expect.objectContaining({ code: 'EMPTY_PROP_NAME', severity: 'error' }),
        expect.objectContaining({ code: 'PROP_SLOT_NAME_COLLISION', severity: 'error' }),
      ]),
    );
  });

  it('preserves rendered zero-surface evidence during source inspection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'source-inspection-'));
    tempDirectories.push(directory);
    const sourcePath = join(directory, 'Card.tsx');
    await writeFile(sourcePath, 'export function Card() { return <div />; }');

    const inspection = await inspectComponentSource(component({ source: sourcePath, props: [], slots: [] }));

    expect(inspection.keepDespiteZeroSurface).toBe(true);
    expect(inspection.reviewReasons).toContain('zero-surface:rendered-ui');
  });
});
