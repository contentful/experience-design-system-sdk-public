import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { extractVueTsxComponents } from '../../../src/steps/extraction/src/framework-adapters/vue-tsx/extractor.js';
import type { RawComponentDefinition } from '../../../src/steps/extraction/src/types/component.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it.each(['pick', 'omit', 'reshape'])(
  'reads the actual returned props instead of assigning behavior to a helper named %s',
  async (name) => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'vue-helper-contract-')));
    roots.push(root);
    const path = join(root, 'Example.tsx');
    writeFileSync(
      path,
      `import { defineComponent } from 'vue';
      function ${name}() {
        return { actual: { type: Boolean, default: true } };
      }
      export const Example = defineComponent({
        props: ${name}(),
        setup(props) { return () => <div>{props.actual}</div>; },
      });`,
    );
    const component = (await extractVueTsxComponents([path])).components[0]!;
    expect(component.props.map((prop) => prop.name)).toEqual(['actual']);
    expect(component.props[0]).toMatchObject({ type: 'boolean', defaultValue: 'true' });
    expect(
      component.sourceCandidates
        ?.filter((candidate) => candidate.projection.kind === 'prop')
        .map((candidate) => candidate.name),
    ).toEqual(['actual']);
  },
);

function writeComponent(files: Record<string, string>): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'vue-helper-convention-')));
  roots.push(root);
  for (const [name, source] of Object.entries(files)) writeFileSync(join(root, name), source);
  return join(root, Object.keys(files)[0]!);
}

it('does not assume an unavailable factory named createInputs returns its first argument', async () => {
  const path = writeComponent({
    'Example.tsx': `import { defineComponent } from 'vue';
      import { createInputs } from './unavailable.js';
      const make = createInputs({ label: String });
      export const Example = defineComponent({ props: make() });`,
  });
  const result = await extractVueTsxComponents([path]);
  expect(result.components[0]?.props).toEqual([]);
  expect(result.components[0]?.sourceCandidates).toContainEqual(
    expect.objectContaining({ facts: expect.objectContaining({ certainty: 'unknown' }) }),
  );
});

it('retains unresolved helper reshape as uncertainty without inventing returned keys', async () => {
  const path = writeComponent({
    'Example.tsx': `import { defineComponent } from 'vue';
      import { reshape } from './unavailable.js';
      const input = { label: String, size: Number };
      export const Example = defineComponent({ props: reshape(input, ['label']) });`,
  });
  const result = await extractVueTsxComponents([path]);
  expect(result.components[0]?.props).toEqual([]);
  expect(result.components[0]?.sourceCandidates).toContainEqual(
    expect.objectContaining({ facts: expect.objectContaining({ certainty: 'unknown' }) }),
  );
  expect(result.extractionDiagnostics?.modules).toContainEqual(
    expect.objectContaining({ reason: expect.stringContaining('vue-props-') }),
  );
});

function conventionCandidates(component: RawComponentDefinition) {
  return Object.fromEntries(
    (component.sourceCandidates ?? [])
      .filter((candidate) => !candidate.name.startsWith('@source:'))
      .map((candidate) => [candidate.name, candidate.facts]),
  );
}

it.each([
  ['pick', ['label']],
  ['omit', ['size']],
])('reads props selected by an unavailable %s helper as uncertain convention reads', async (name, expected) => {
  const path = writeComponent({
    'Example.tsx': `import { defineComponent } from 'vue';
      import { ${name} } from './unavailable.js';
      const input = { label: String, size: Number };
      export const Example = defineComponent({ props: ${name}(input, ['label']) });`,
  });
  const result = await extractVueTsxComponents([path]);
  const component = result.components[0]!;
  expect(component.props.map((prop) => prop.name)).toEqual(expected);
  expect(Object.keys(conventionCandidates(component))).toEqual(expected);
  expect(conventionCandidates(component)[expected[0]!]).toMatchObject({
    certainty: 'unknown',
    ambiguityReason: 'vue-runtime-helper-convention',
  });
  expect(result.extractionDiagnostics?.modules).toContainEqual(
    expect.objectContaining({ reason: 'vue-props-partial' }),
  );
});

it('reads Vuetify-style picked props from an imported props factory', async () => {
  const path = writeComponent({
    'Chip.tsx': `import { defineComponent, type PropType } from 'vue';
      import { pick, propsFactory } from './util.js';
      import { makeSizeProps } from './size.js';
      export const makeChipProps = propsFactory({
        label: { type: String, required: true },
        ...pick(makeSizeProps(), ['size'] as const),
        variant: { type: String as PropType<'flat' | 'outlined'>, default: 'flat' },
      }, 'VChip');
      export const Chip = defineComponent({ name: 'VChip', props: makeChipProps({ variant: 'outlined' }) });`,
    'util.ts': `export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
        const found = {} as Pick<T, K>;
        for (const key of keys) found[key] = obj[key];
        return found;
      }
      export function propsFactory<P extends object>(props: P, source: string) {
        return (defaults?: Partial<P>) => Object.keys(props).reduce((obj, prop) => ({ ...obj, [prop]: props[prop as keyof P] }), {} as P);
      }`,
    'size.ts': `import { propsFactory } from './util.js';
      export const makeSizeProps = propsFactory({ size: { type: [String, Number], default: 'default' }, density: String }, 'size');`,
  });
  const result = await extractVueTsxComponents([path]);
  const component = result.components[0]!;
  expect(component.name).toBe('VChip');
  expect(component.props).toEqual([
    { name: 'label', type: 'string', required: true },
    { name: 'size', type: 'string | number', required: false, defaultValue: "'default'" },
    { name: 'variant', type: '"flat" | "outlined"', required: false, defaultValue: "'flat'" },
  ]);
  const facts = conventionCandidates(component);
  expect(Object.keys(facts).sort()).toEqual(['label', 'size', 'variant']);
  for (const fact of Object.values(facts))
    expect(fact).toMatchObject({ certainty: 'unknown', ambiguityReason: 'vue-runtime-helper-convention' });
  expect(component.sourceCandidates?.some((candidate) => candidate.name.startsWith('@source:'))).toBe(false);
});
