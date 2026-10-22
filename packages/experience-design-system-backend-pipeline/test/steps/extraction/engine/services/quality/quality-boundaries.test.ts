import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  RawComponentDefinition,
  RawPropDefinition,
} from '../../../../../../src/steps/extraction/src/types/component.js';
import { hasNoAuthoringSurface } from '../../../../../../src/steps/extraction/src/services/quality/helpers/authorability/evaluate-authorability.js';
import { extractReactComponents } from '../../../../../../src/steps/extraction/src/framework-adapters/react/extractor.js';
import { inspectComponentSource } from '../../../../../../src/steps/extraction/src/services/quality/helpers/inspection/inspect-component-source.js';
import { validateExtractedComponents } from '../../../../../../src/steps/extraction/src/services/quality/helpers/inspection/validate-extracted-components.js';

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
  it.each(['Card.tsx', 'Card-gql.tsx'])(
    'does not infer infrastructure or wrapper behavior from names in %s',
    async (filename) => {
      const directory = await mkdtemp(join(tmpdir(), 'source-inspection-'));
      tempDirectories.push(directory);
      const sourcePath = join(directory, filename);
      await writeFile(
        sourcePath,
        `
        import { useDemoQuery } from './__generated/queries';
        import { Surface } from './Surface';
        export function Card({ id, locale }: { id: string; locale: string }) {
          const { data, loading } = useDemoQuery(id);
          if (loading || !data) return null;
          return <Surface {...data} locale={locale} />;
        }
      `,
      );
      const extracted = (await extractReactComponents([sourcePath])).components[0]!;
      const inspection = await inspectComponentSource(extracted);
      expect(inspection.wrapperConfidence).toBe(0);
      expect(inspection.reviewReasons.some((reason) => reason.includes('data-wrapper'))).toBe(false);
      expect(extracted.componentFacts?.sourceObservations?.observations.some((entry) => entry.kind === 'call')).toBe(
        true,
      );
    },
  );

  it('does not use another export or an uncalled callback as returned markup evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'source-inspection-'));
    tempDirectories.push(directory);
    const sourcePath = join(directory, 'Surface.tsx');
    await writeFile(
      sourcePath,
      `
      export function Empty() { const make = () => <div />; return null; }
      export function Visible() { return <div />; }
    `,
    );
    const extracted = (await extractReactComponents([sourcePath])).components;
    expect(
      (await inspectComponentSource(extracted.find((entry) => entry.name === 'Empty')!)).keepDespiteZeroSurface,
    ).toBe(false);
    expect(
      (await inspectComponentSource(extracted.find((entry) => entry.name === 'Visible')!)).keepDespiteZeroSurface,
    ).toBe(true);
  });

  it.each([
    ['<arbitrary-element />', true],
    ['(<><div /></>)', true],
    ['[<div />]', true],
    ['true ? <div /> : null', true],
    ['consume(<div />)', false],
    ["'return <div />'", false],
    ['<div /> && 0', false],
  ])('uses returned syntax rather than text matches for %s', async (expression, expected) => {
    const directory = await mkdtemp(join(tmpdir(), 'source-inspection-'));
    tempDirectories.push(directory);
    const sourcePath = join(directory, 'Surface.tsx');
    await writeFile(sourcePath, `export function Surface() { return ${expression}; }`);
    const extracted = (await extractReactComponents([sourcePath])).components[0]!;
    expect((await inspectComponentSource(extracted)).keepDespiteZeroSurface).toBe(expected);
  });

  it('treats absent captured source as unknown even when a live file renders markup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'source-inspection-'));
    tempDirectories.push(directory);
    const sourcePath = join(directory, 'Surface.tsx');
    await writeFile(sourcePath, 'export function Surface() { return <div />; }');
    expect(await inspectComponentSource(component({ source: sourcePath, props: [], slots: [] }))).toEqual({
      wrapperConfidence: 0,
      reviewReasons: [],
      keepDespiteZeroSurface: false,
    });
  });

  it('filters components whose entire prop surface is handler or ref plumbing', () => {
    expect(
      hasNoAuthoringSurface(
        component({
          props: [prop({ name: 'onReady', type: '() => void' })],
        }),
      ),
    ).toEqual({ skip: true, reason: 'every prop is a handler or ref' });
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
        expect.objectContaining({
          code: 'EMPTY_COMPONENT_NAME',
          severity: 'error',
        }),
        expect.objectContaining({ code: 'EMPTY_PROP_NAME', severity: 'error' }),
        expect.objectContaining({
          code: 'PROP_SLOT_NAME_COLLISION',
          severity: 'error',
        }),
      ]),
    );
  });

  it('preserves rendered zero-surface evidence during source inspection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'source-inspection-'));
    tempDirectories.push(directory);
    const sourcePath = join(directory, 'Card.tsx');
    await writeFile(sourcePath, 'export function Card() { return <div />; }');

    const extracted = (await extractReactComponents([sourcePath])).components[0]!;
    await writeFile(sourcePath, 'export function Card() { return null; }');
    const inspection = await inspectComponentSource(extracted);

    expect(inspection.keepDespiteZeroSurface).toBe(true);
    expect(inspection.reviewReasons).toContain('zero-surface:rendered-ui');
  });
});
