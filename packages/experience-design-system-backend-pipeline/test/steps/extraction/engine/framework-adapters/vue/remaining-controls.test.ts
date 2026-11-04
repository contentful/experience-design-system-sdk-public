import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { extractEndpoint } from '../../../../../../src/steps/extraction/index.js';
const roots: string[] = [];
function fixture(files: Record<string, string>) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'vue-source-contract-')));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
it('retains actual compiler resolved alias and enum literal domains with source spelling', async () => {
  const root = fixture({
    'values.ts': `export type Names = 'first' | 'second'; export enum Values { Small = 1, Large = 4 }`,
    'Example.vue': `<script setup lang="ts">import type { PropType } from 'vue'; import { type Names, Values } from './values.js'; const Text = String; defineProps({ names: String as PropType<Names>, values: Number as PropType<Values>, constructors: [Text, Number], mixed: String as PropType<Names | number>, unrelated: String as Array<'pretend'>, missing: UnknownConstructor });</script>`,
  });
  const result = await extractEndpoint({ filePaths: [join(root, 'Example.vue')], projectRoot: root });
  const candidates = result.components[0]!.sourceCandidates!;
  expect(candidates.find((c) => c.name === 'names')?.facts).toMatchObject({
    sourceTypeText: 'Names',
    domain: {
      openness: 'closed',
      observedLiterals: [
        { kind: 'string', value: 'first' },
        { kind: 'string', value: 'second' },
      ],
    },
  });
  expect(candidates.find((c) => c.name === 'values')?.facts?.domain).toMatchObject({
    openness: 'closed',
    observedLiterals: [
      { kind: 'number', value: '1' },
      { kind: 'number', value: '4' },
    ],
  });
  expect(candidates.find((c) => c.name === 'constructors')?.type).toBe('string | number');
  for (const name of ['constructors', 'mixed', 'unrelated'])
    expect(candidates.find((c) => c.name === name)?.facts?.domain.openness).not.toBe('closed');
  expect(candidates.find((c) => c.name === 'missing')?.facts?.domain.openness).toBe('unknown');
});
it.each(['tsx', 'jsx'])(
  'resolves bound returned options and Vue import aliases on the actual public %s endpoint',
  async (extension) => {
    const root = fixture({
      'props.ts': `export const shared = { label: { type: String, default: '' } }; export function options() { const props = { ...shared, count: Number }; return { props }; }`,
      [`Example.${extension}`]: `import { defineComponent as create } from 'vue'; import { options } from './props.js'; export const Example = create(options());`,
    });
    const result = await extractEndpoint({ filePaths: [join(root, `Example.${extension}`)], projectRoot: root });
    const component = result.components.find((c) => c.framework === 'vue' && c.name === 'Example');
    expect(component?.props.map((p) => p.name)).toEqual(['count', 'label']);
    expect(component?.sourceCandidates?.find((c) => c.name === 'label')).toMatchObject({
      sourceDefault: "''",
      facts: { origin: 'imported', declarations: [{ canonicalPath: join(root, 'props.ts') }] },
    });
  },
);
it('marks an unbound component helper as uncertain while preserving existing raw candidates', async () => {
  const root = fixture({ 'Example.tsx': `export const Example = defineComponent({ props: { label: String } });` });
  const result = await extractEndpoint({ filePaths: [join(root, 'Example.tsx')], projectRoot: root });
  expect(
    result.components.find((c) => c.framework === 'vue')?.sourceCandidates?.find((c) => c.name === 'label')?.facts
      ?.certainty,
  ).toBe('unknown');
  expect(result.extractionDiagnostics?.modules).toContainEqual(
    expect.objectContaining({ reason: 'vue-component-binding-unresolved' }),
  );
});

it.each([
  ['tsx', 'defineComponent'],
  ['jsx', 'defineComponent'],
  ['tsx', 'genericComponent()'],
  ['jsx', 'genericComponent()'],
])(
  'retains declaration ambiguity and independent unresolved facts beside an unbound %s %s',
  async (extension, factory) => {
    const root = fixture({
      'props.ts': `export const shared = { key: { type: String, default: 'first' } };`,
      'helper.ts': `export function genericComponent() { return (options: unknown) => options; }`,
      [`Example.${extension}`]: `import { shared } from './props.js'; import { genericComponent } from './helper.js'; function parameter(value) { return value; } export const Example = ${factory}({ props: { key: Number, ...shared, key: { type: Boolean, default: false }, ...parameter({}) } });`,
    });
    const result = await extractEndpoint({ filePaths: [join(root, `Example.${extension}`)], projectRoot: root });
    const component = result.components.find((candidate) => candidate.framework === 'vue')!;
    const key = component.sourceCandidates!.find((candidate) => candidate.name === 'key')!;
    expect(key.facts).toMatchObject({ certainty: 'ambiguous', ambiguityReason: 'conflicting-declarations' });
    expect(key.facts?.declarations).toHaveLength(3);
    expect(key.facts?.domain.openness).not.toBe('closed');
    const declarations = key.observations.filter((observation) => observation.evidenceKind === 'declaration');
    expect(declarations).toHaveLength(3);
    for (const observation of declarations) {
      expect(observation.fact).toMatchObject({
        certainty: 'unknown',
        ambiguityReason: 'vue-component-binding-unresolved',
      });
      expect(observation.syntax).toMatchObject({
        resolution: 'unresolved',
        resolutionReason: 'vue-component-binding-unresolved',
      });
    }
    const unresolved = component.sourceCandidates!.find((candidate) => candidate.name.startsWith('@source:'))!;
    expect(unresolved.facts).toMatchObject({ certainty: 'unknown', ambiguityReason: 'declaration-origin-unavailable' });
    expect(unresolved.observations[0]?.syntax).toMatchObject({
      resolution: 'unresolved',
      resolutionReason: 'vue-runtime-call-unresolved',
    });
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-component-binding-unresolved' }),
    );
  },
);

it('resolves typed aliases from compiler alternatives while nested quoted types and open values stay nonfinite', async () => {
  const root = fixture({
    'types.ts': `export type Names = 'first' | 'second'; export enum Values { Low = 0, High = 8 }; export type Mixed = Names | number;`,
    'Typed.vue': `<script setup lang="ts">import type { Names, Values, Mixed } from './types.js'; defineProps<{ names: Names; numeric: Values; mixed: Mixed; nested: { value: 'pretend' }; unknown: Missing }>();</script>`,
  });
  const result = await extractEndpoint({ filePaths: [join(root, 'Typed.vue')], projectRoot: root });
  const c = result.components[0]!.sourceCandidates!;
  expect(c.find((x) => x.name === 'names')?.facts).toMatchObject({
    sourceTypeText: 'Names',
    domain: {
      openness: 'closed',
      observedLiterals: [
        { kind: 'string', value: 'first' },
        { kind: 'string', value: 'second' },
      ],
    },
  });
  expect(c.find((x) => x.name === 'numeric')?.facts?.domain.observedLiterals).toEqual([
    { kind: 'number', value: '0' },
    { kind: 'number', value: '8' },
  ]);
  for (const name of ['mixed', 'nested', 'unknown'])
    expect(c.find((x) => x.name === name)?.facts?.domain.openness).not.toBe('closed');
  expect(c.find((x) => x.name === 'nested')?.facts?.domain.observedLiterals).toEqual([]);
});
it('uses declaration-bound PropType import aliases and namespace assertions without honoring shadowed generic names or mutable constructors', async () => {
  const root = fixture({
    'Example.vue': `<script setup lang="ts">import type { PropType as P } from 'vue'; import type * as V from 'vue'; type PropType<T> = T; let Mutable = String; Mutable = UnknownConstructor; defineProps({ alias: String as P<'first' | 'second'>, namespace: Number as V.PropType<1 | -2>, unrelated: String as PropType<'pretend'>, mutable: Mutable });</script>`,
  });
  const c = (await extractEndpoint({ filePaths: [join(root, 'Example.vue')], projectRoot: root })).components[0]!
    .sourceCandidates!;
  expect(c.find((x) => x.name === 'alias')?.facts?.domain.openness).toBe('closed');
  expect(c.find((x) => x.name === 'namespace')?.facts?.domain.observedLiterals).toEqual([
    { kind: 'number', value: '1' },
    { kind: 'number', value: '-2' },
  ]);
  expect(c.find((x) => x.name === 'unrelated')?.facts?.domain).toEqual({ openness: 'open', observedLiterals: [] });
  expect(c.find((x) => x.name === 'mutable')?.type).toBe('unknown');
});
it('conserves repeated returned declarations and explicit unresolved parameter, branch and cycle calls without executing source', async () => {
  const root = fixture({
    'Example.tsx': `import { defineComponent } from 'vue'; const shared={ label: { type: String, default: '' } }; function values(){const local={...shared, count:Number};return local;} function parameter(value:unknown){ return value; } function branching(){ if (unknownFlag) return { invented:Boolean }; return {}; } function cycle(){return cycle();} export const Example=defineComponent({props:{...values(),...values(),...parameter(shared),...branching(),...cycle()}}); throw new Error('source must never execute');`,
  });
  const result = await extractEndpoint({ filePaths: [join(root, 'Example.tsx')], projectRoot: root });
  const c = result.components.find((x) => x.framework === 'vue')!.sourceCandidates!;
  expect(c.find((x) => x.name === 'label')?.observations.filter((x) => x.evidenceKind === 'declaration')).toHaveLength(
    2,
  );
  expect(c.some((x) => x.name === 'invented')).toBe(false);
  expect(
    c
      .filter((x) => x.name.startsWith('@source:'))
      .every(
        (x) => x.observations[0]?.syntax?.reader === 'vue' && x.observations[0].syntax.resolution === 'unresolved',
      ),
  ).toBe(true);
  expect(result.extractionDiagnostics?.modules.filter((x) => x.reason === 'vue-runtime-call-unresolved')).toHaveLength(
    3,
  );
});

it('follows a declaration-backed zero-argument component factory and preserves generic contract provenance', async () => {
  const root = fixture({
    'helper.ts': `import {defineComponent} from 'vue';export function genericComponent<T>(){return defineComponent;}export function arbitraryFactory(){return defineComponent;}`,
    'Example.tsx': `import {genericComponent,arbitraryFactory} from './helper.js';export const Example=genericComponent<{heading(value:string):unknown}>()({props:{label:String}});export const Other=arbitraryFactory()({props:{count:Number}});`,
  });
  const result = await extractEndpoint({ filePaths: [join(root, 'Example.tsx')], projectRoot: root });
  expect(
    result.components.find((c) => c.name === 'Example')?.sourceCandidates?.find((c) => c.name === 'label')?.facts
      ?.certainty,
  ).toBe('certain');
  expect(
    result.components.find((c) => c.name === 'Example')?.sourceCandidates?.find((c) => c.name === 'heading')
      ?.observations[0]?.syntax,
  ).toMatchObject({ reader: 'vue', channel: 'slot-contract' });
  expect(result.components.find((c) => c.name === 'Other')?.props.map((p) => p.name)).toEqual(['count']);
});

it.each(['let', 'var'])('retains %s declarations returned by zero-argument prop helpers', async (kind) => {
  const root = fixture({
    'Example.vue': `<script setup>function values(){${kind} local={label:String};return local;}defineProps(values());</script>`,
  });
  const path = join(root, 'Example.vue');
  const result = await extractEndpoint({ filePaths: [path], projectRoot: root });
  const component = result.components[0]!;
  expect(component.props.map(({ name, type, required }) => ({ name, type, required }))).toEqual([
    { name: 'label', type: 'string', required: false },
  ]);
  const candidate = component.sourceCandidates?.find((candidate) => candidate.name === 'label');
  expect(candidate?.evidenceKinds).toContain('declaration');
  expect(candidate?.facts?.declarations).toContainEqual(expect.objectContaining({ canonicalPath: path }));
});
