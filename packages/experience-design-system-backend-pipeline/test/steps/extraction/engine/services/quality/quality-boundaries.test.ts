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
import { evaluateExtractionQuality } from '../../../../../../src/steps/extraction/src/services/quality/evaluate-extraction-quality.js';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  loadRawComponents,
  loadScopeComponents,
} from '../../../../../../src/persistence/src/session/repositories/db.js';

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
  it.each([
    ['onReady', 'string'],
    ['setCount', 'number'],
    ['ref', 'string'],
    ['innerRef', 'boolean'],
    ['arbitrary', '() => void'],
    ['arbitrary', 'EventHandler'],
    ['arbitrary', 'Dispatch<SetStateAction<number>>'],
    ['arbitrary', 'RefObject<string>'],
    ['arbitrary', 'MutableRefObject<string>'],
  ])('does not conclude authorability from spelling or type text: %s %s', async (name, type) => {
    const input = component({ props: [prop({ name, type })] });
    const before = JSON.stringify(input);
    const result = await evaluateExtractionQuality([input]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.props).toEqual(input.props);
    expect(result.components[0]?.reviewReasons).toEqual([]);
    expect(result.components[0]?.needsReview).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    { props: [prop({ name: 'value' })], slots: [] },
    { props: [prop({ name: 'arbitrary' })], slots: [] },
    { props: [], slots: [{ name: 'arbitrary', isDefault: false }] },
  ])('does not conclude authorability from a file-level context flag: %j', async (surface) => {
    const input = component({ ...surface, usesCreateContext: true });
    const result = await evaluateExtractionQuality([input]);
    expect(result.components[0]).toMatchObject({ ...input, needsReview: false, reviewReasons: [] });
    expect(result.warnings).toEqual([]);
  });

  it('does not let unrelated context creation decide an extracted component authorability', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'source-inspection-'));
    tempDirectories.push(directory);
    const sourcePath = join(directory, 'Surface.tsx');
    await writeFile(
      sourcePath,
      `
      declare function createContext(value: null): unknown;
      const unrelated = createContext(null);
      export function Surface(props: { value: string }) { return <div>{props.value}</div>; }
    `,
    );
    const input = (await extractReactComponents([sourcePath])).components[0]!;
    expect(input.usesCreateContext).toBe(true);
    const result = await evaluateExtractionQuality([input]);
    expect(result.components[0]?.reviewReasons).toEqual([]);
    expect(result.components[0]?.needsReview).toBe(false);
    expect(result.components[0]?.componentFacts).toEqual(input.componentFacts);
    expect(result.components[0]?.sourceCandidates).toEqual(input.sourceCandidates);
    expect(result.warnings).toEqual([]);
  });

  it('keeps absent surface as a review observation rather than a non-authorability judgment', async () => {
    const input = component({ props: [], slots: [], usesCreateContext: true });
    const result = await evaluateExtractionQuality([input]);
    expect(result.components[0]?.needsReview).toBe(true);
    expect(result.components[0]?.reviewReasons).toEqual(['surface-unobserved:component has no props and no slots']);
    expect(result.warnings).toContain('Button: requires operator review (component has no props and no slots)');
  });

  it('preserves explicit review decisions independently of spelling and context observations', async () => {
    const input = component({
      props: [prop({ name: 'value' })],
      usesCreateContext: true,
      needsReview: true,
      reviewReasons: ['operator-requested-review'],
    });
    const result = await evaluateExtractionQuality([input]);
    expect(result.components[0]?.needsReview).toBe(true);
    expect(result.components[0]?.reviewReasons).toEqual(['operator-requested-review']);
  });

  it('saves fresh neutral review observations without inventing an agent decision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'surface-review-'));
    tempDirectories.push(directory);
    const result = await evaluateExtractionQuality([
      component({ name: 'Present', props: [prop({ name: 'value' })], usesCreateContext: true }),
      component({ name: 'Absent', props: [], slots: [] }),
    ]);
    const path = join(directory, 'pipeline.db');
    const db = openPipelineDb(path);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    try {
      storeRawComponents(db, sessionId, result.components);
    } finally {
      db.close();
    }
    const reopened = openPipelineDb(path);
    try {
      const saved = loadRawComponents(reopened, sessionId);
      expect(saved.find((item) => item.name === 'Present')).toMatchObject({ needsReview: false, reviewReasons: [] });
      expect(saved.find((item) => item.name === 'Absent')).toMatchObject({
        needsReview: true,
        reviewReasons: ['surface-unobserved:component has no props and no slots'],
      });
      expect(
        loadScopeComponents(reopened, sessionId).map(({ aiDecision, aiReason }) => ({ aiDecision, aiReason })),
      ).toEqual([
        { aiDecision: null, aiReason: null },
        { aiDecision: null, aiReason: null },
      ]);
    } finally {
      reopened.close();
    }
  });

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

  it('leaves callable source inputs for semantic classification', () => {
    expect(
      hasNoAuthoringSurface(
        component({
          props: [prop({ name: 'onReady', type: '() => void' })],
        }),
      ),
    ).toEqual({ skip: false });
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
