import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as extraction from '../../../../../src/steps/extraction/index.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe('component facts carrier', () => {
  it('exposes a neutral optional field-local assembly seam', () => {
    const context = {
      name: 'Panel',
      sourcePath: '/example/Panel.tsx',
      framework: 'react' as const,
      sourceText: 'export const Panel = () => null;',
      declaredTypeText: null,
    };
    expect(extraction.assembleComponentFacts(context)).toBeUndefined();
    expect(extraction.assembleComponentFacts(context, { renderables: () => [] })).toBeUndefined();
    const renderable = {
      name: 'content',
      delivery: 'node-prop' as const,
      certainty: 'unknown' as const,
      location: null,
      sourceTypeText: 'string | Element',
      elementTyped: null,
      origin: 'unknown' as const,
    };
    const result = extraction.assembleComponentFacts(context, {
      renderables: () => [renderable],
      members: () => [{ name: 'Item', certainty: 'certain', location: null }],
    });
    expect(result?.renderables).toEqual([renderable]);
    expect(result?.members).toHaveLength(1);
    expect(result?.nonStatic).toBeUndefined();
    expect(result?.schemaVersion).toBe(extraction.COMPONENT_FACT_SCHEMA_VERSION);
  });

  it('injects observations through both parameterful and parameterless public producers without changing ordinary fields', async () => {
    const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'component-facts-')));
    directories.push(directory);
    const path = join(directory, 'Panel.tsx');
    writeFileSync(
      path,
      `type Props = { label: 'short' | 'long'; count?: number };\nexport function Panel({ label = 'short', count = 0 }: Props) { return <div>{label}{count}</div>; }\nexport function Empty() { return <div/>; }`,
    );
    const baseline = await extraction.extractReactComponents([path]);
    const calls: string[] = [];
    const supplied = await extraction.extractReactComponents([path], undefined, {
      componentFactCollectors: {
        nonStatic: (context) => {
          calls.push(context.name);
          return [
            {
              kind: 'external-call',
              name: 'readValue',
              certainty: 'ambiguous',
              location: context.declaration,
              declaredIn: 'example.ts',
              packageName: 'example-package',
            },
          ];
        },
      },
    });
    expect(calls.sort()).toEqual(['Empty', 'Panel']);
    expect(
      baseline.components.every((component) => component.componentFacts?.sourceObservations?.observations.length),
    ).toBe(true);
    for (const component of supplied.components) {
      const { componentFacts, ...ordinary } = component;
      const { componentFacts: _baselineFacts, ...baselineOrdinary } = baseline.components.find(
        (candidate) => candidate.name === component.name,
      )!;
      expect(ordinary).toEqual(baselineOrdinary);
      expect(componentFacts?.nonStatic?.[0]?.location).toMatchObject({
        canonicalPath: path,
        textHash: expect.any(String),
        startOffset: expect.any(Number),
        endOffset: expect.any(Number),
        binding: 'unverified',
      });
    }
    const panel = supplied.components.find((component) => component.name === 'Panel')!;
    expect(panel.sourceCandidates?.find((candidate) => candidate.name === 'label')).toMatchObject({
      declaredRequired: true,
      sourceDefault: "'short'",
      facts: { domain: { openness: 'closed' } },
    });
  });

  it('binds every component location without mutating input or upgrading missing and changed source', () => {
    const location = {
      fileId: null,
      canonicalPath: '/example/Panel.tsx',
      textHash: 'exact',
      startLine: 1,
      endLine: 1,
      startOffset: 0,
      endOffset: 4,
      binding: 'unverified' as const,
    };
    const component: extraction.RawComponentDefinition = {
      name: 'Panel',
      source: '/example/Panel.tsx',
      framework: 'react',
      props: [],
      slots: [],
      componentFacts: {
        schemaVersion: 1,
        members: [{ name: 'Item', certainty: 'certain', location }],
        childFilters: [{ slot: 'content', kind: 'type-check', allowed: ['Item'], certainty: 'ambiguous', location }],
        requiresParent: [{ parent: 'Parent', reason: 'context-missing', certainty: 'unknown', location }],
        nonStatic: [{ kind: 'external-call', certainty: 'unknown', location }],
        renderables: [{ name: 'content', delivery: 'node-prop', certainty: 'unknown', location }],
        referencedOrigins: [
          {
            name: 'Item',
            certainty: 'ambiguous',
            location,
            origin: { kind: 'unresolved', certainty: 'unknown', location },
          },
        ],
        origin: { kind: 'in-repository', certainty: 'certain', location },
      },
    };
    for (const [files, binding] of [
      [[{ canonicalPath: location.canonicalPath, textHash: 'exact' }], 'verified'],
      [[{ canonicalPath: location.canonicalPath, textHash: 'different' }], 'changed'],
      [[{ canonicalPath: location.canonicalPath, textHash: null }], 'unverified'],
      [[], 'unavailable'],
    ] as const) {
      const bound = extraction.bindSourceCandidatesToCapture([component], files)[0]!.componentFacts!;
      expect(bound.renderables?.[0]?.location?.binding).toBe(binding);
      expect(bound.members?.[0]?.location?.binding).toBe(binding);
      expect(bound.childFilters?.[0]?.location?.binding).toBe(binding);
      expect(bound.requiresParent?.[0]?.location?.binding).toBe(binding);
      expect(bound.nonStatic?.[0]?.location?.binding).toBe(binding);
      expect(bound.origin?.location?.binding).toBe(binding);
      expect(bound.referencedOrigins?.[0]?.location?.binding).toBe(binding);
      expect(bound.referencedOrigins?.[0]?.origin.location?.binding).toBe(binding);
    }
    expect(component.componentFacts?.origin?.location?.binding).toBe('unverified');
  });
});
