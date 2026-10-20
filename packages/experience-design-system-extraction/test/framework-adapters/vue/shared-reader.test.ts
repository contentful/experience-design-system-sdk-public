import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Node } from 'ts-morph';
import { extractVueComponents } from '../../../src/extract/framework-adapters/vue/extractor.js';
import { extractVueTsxComponents } from '../../../src/extract/framework-adapters/vue-tsx/extractor.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
afterEach(() => vi.restoreAllMocks());
function fixture(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), 'vue-reader-'));
  directories.push(directory);
  for (const [name, source] of Object.entries(files)) writeFileSync(join(directory, name), source);
  return directory;
}

describe('configured Vue source reader', () => {
  it('does not accept a shadowed defineOptions call as the owning component declaration', async () => {
    const root = fixture({
      'ShadowOptions.vue': `<script setup lang="ts">const defineOptions = (value: unknown) => value; defineOptions({ name: 'Pretend', props: { invented: String } });</script>`,
    });
    const result = await extractVueComponents([join(root, 'ShadowOptions.vue')]);
    expect(result.components[0]?.name).toBe('ShadowOptions');
    expect(result.components[0]?.props).toEqual([]);
    expect(result.components[0]?.sourceCandidates).toEqual([]);
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-macro-binding-unresolved' }),
    );
  });

  it('uses the last literal prop option field rather than overwritten metadata', async () => {
    const root = fixture({
      'Options.vue': `<script setup lang="ts">defineProps({ label: { type: Number, type: String, required: true, required: false, default: 0, default: '' } });</script>`,
    });
    const component = (await extractVueComponents([join(root, 'Options.vue')])).components[0]!;
    expect(component.props.find((prop) => prop.name === 'label')).toMatchObject({
      type: 'string',
      required: false,
      defaultValue: "''",
    });
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'label')).toMatchObject({
      type: 'string',
      declaredRequired: false,
      sourceDefault: "''",
    });
  });

  it('retains spread prop options without fabricating known type, requiredness or default', async () => {
    const root = fixture({
      'Options.vue': `<script setup lang="ts">defineProps({ label: { type: String, required: true, default: 'first', ...unknownOptions } });</script>`,
    });
    const result = await extractVueComponents([join(root, 'Options.vue')]);
    const label = result.components[0]?.sourceCandidates?.find((candidate) => candidate.name === 'label');
    expect(label).toMatchObject({ type: 'unknown', declaredRequired: null, sourceDefault: null });
    expect(label?.observations[0]?.syntax).toMatchObject({
      reader: 'vue',
      resolution: 'partial',
      default: { expression: "'first'", state: 'unresolved', value: null },
    });
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-runtime-options-unresolved' }),
    );
  });

  it('does not establish named slots from a shadowed useSlots binding', async () => {
    const root = fixture({
      'Shadow.vue': `<script lang="ts">import { useSlots } from 'vue'; export default { setup() { const useSlots = () => ({ pretend: () => '' }); const actual = useSlots(); actual.pretend; } };</script>`,
    });
    const result = await extractVueComponents([join(root, 'Shadow.vue')]);
    expect(result.components[0]?.slots).toEqual([]);
    expect(result.components[0]?.sourceCandidates?.some((candidate) => candidate.name === 'pretend')).toBe(false);
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-slots-binding-unresolved' }),
    );
  });

  it('combines both scripts, keeps declared names and exact SFC declaration lines', async () => {
    const root = fixture({
      'Card.vue': `<script lang="ts">\nimport type { Shared } from './types.js';\ntype Props = Shared & { local: boolean };\nexport default { name: 'DeclaredCard' };\n</script>\n<script setup lang="ts">\nconst { label: title = '', local = false } = defineProps<Props>();\n</script>`,
      'types.ts': `export interface Shared { label: string; '_key': 1 | 2 }`,
    });
    const result = await extractVueComponents([join(root, 'Card.vue'), join(root, 'types.ts')], undefined, {
      projectRoot: root,
    });
    expect(result.components.map((component) => component.name)).toEqual(['DeclaredCard']);
    const candidates = result.components[0]!.sourceCandidates!;
    expect(candidates.map((candidate) => candidate.name).sort()).toEqual(['_key', 'label', 'local']);
    expect(candidates.find((candidate) => candidate.name === 'local')).toMatchObject({
      sourceDefault: 'false',
      declaredRequired: true,
      facts: { origin: 'own', declarations: [{ canonicalPath: join(root, 'Card.vue'), startLine: 3 }] },
    });
    expect(candidates.find((candidate) => candidate.name === 'label')?.sourceDefault).toBe("''");
  });

  it('binds only matching withDefaults macros and preserves defaults without executing factories', async () => {
    const root = fixture({
      'Defaults.vue': `<script setup lang="ts">\nconst props = withDefaults(defineProps<{ 'a.b/c': string; zero: number; factory?: object }>(), { 'a.b/c': '', zero: 0, factory: () => ({}) });\nwithDefaults(other(), { zero: 99 });\n</script>`,
    });
    const component = (await extractVueComponents([join(root, 'Defaults.vue')])).components[0]!;
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'zero')).toMatchObject({
      sourceDefault: '0',
      declaredRequired: true,
    });
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'a.b/c')).toMatchObject({
      keyPath: ['a.b/c'],
      sourceDefault: "''",
    });
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'factory')?.observations).toContainEqual(
      expect.objectContaining({
        syntax: expect.objectContaining({ reader: 'vue', default: expect.objectContaining({ state: 'unresolved' }) }),
      }),
    );
  });

  it('retains every imported spread occurrence and conflict while runtime projection follows source order', async () => {
    const root = fixture({
      'props.ts': `export const first = { key: { type: String, default: 'first' }, '$flag': Boolean }; export const nested = { ...first, key: { type: Number, default: 2 } };`,
      'index.ts': `export { nested as aliased } from './props.js';`,
      'Spread.vue': `<script setup lang="ts">\nimport { aliased as shared } from './index.js';\nconst props = defineProps({ key: { type: Boolean, default: false }, ...shared, key: { type: String, default: 'last' }, ...shared });\n</script>`,
    });
    const component = (await extractVueComponents([join(root, 'Spread.vue')], undefined, { projectRoot: root }))
      .components[0]!;
    const key = component.sourceCandidates!.find((candidate) => candidate.name === 'key')!;
    expect(key.observations.filter((observation) => observation.evidenceKind === 'declaration')).toHaveLength(6);
    expect(key.facts).toMatchObject({ certainty: 'ambiguous', ambiguityReason: 'conflicting-declarations' });
    expect(component.props.find((prop) => prop.name === 'key')).toMatchObject({ type: 'number', defaultValue: '2' });
    expect(component.sourceCandidates?.some((candidate) => candidate.name === '$flag')).toBe(true);
  });

  it('keeps independent contract/template/access observations without inventing dynamic default slots', async () => {
    const root = fixture({
      'Slots.vue': `<script lang="ts">export default { name: 'Slots', props: { heading: String } };</script>\n<script setup lang="ts">\nimport { useSlots } from 'vue';\ndefineSlots<{ heading?: (value: { text: string }) => unknown }>();\nconst actual = useSlots();\nactual['footer']; actual[dynamic];\nconst text = '$slots.fake'; // $slots.comment\n</script>\n<template><div v-if="visible"><slot name="heading">{{ heading }}</slot></div><slot v-else name="heading"/><slot v-for="item in items" :name="item.name"/></template>`,
    });
    const component = (await extractVueComponents([join(root, 'Slots.vue')])).components[0]!;
    const heading = component.sourceCandidates?.find((candidate) => candidate.name === 'heading');
    expect(heading?.observations).toContainEqual(
      expect.objectContaining({ syntax: expect.objectContaining({ reader: 'vue', channel: 'slot-contract' }) }),
    );
    expect(
      heading?.observations.filter((observation) => JSON.stringify(observation.syntax).includes('slot-template')),
    ).toHaveLength(2);
    expect(component.slots.map((slot) => slot.name)).toEqual(['footer', 'heading']);
    expect(component.sourceCandidates?.some((candidate) => JSON.stringify(candidate).includes('dynamic-name'))).toBe(
      true,
    );
    expect(component.sourceCandidates?.some((candidate) => ['fake', 'comment'].includes(candidate.name))).toBe(false);
    expect(heading?.projection.kind).toBe('prop');
  });

  it('distinguishes empty, absent and unresolved declarations and preserves zero-component parse failures', async () => {
    const root = fixture({
      'Empty.vue': '<script setup lang="ts">defineProps<{}>(); defineSlots<{}>();</script>',
      'Absent.vue': '<template><div/></template>',
      'Unknown.vue':
        '<script setup lang="ts">import type { Missing } from "./missing.js"; defineProps<Missing>(); defineSlots<unknown>();</script>',
      'Broken.vue': '<script setup lang="ts">const = ;</script><template><div></template>',
    });
    const result = await extractVueComponents(
      ['Empty.vue', 'Absent.vue', 'Unknown.vue', 'Broken.vue'].map((name) => join(root, name)),
    );
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ fromPath: join(root, 'Empty.vue'), reason: 'vue-props-empty' }),
    );
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ fromPath: join(root, 'Absent.vue'), reason: 'vue-props-absent' }),
    );
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ fromPath: join(root, 'Unknown.vue'), reason: 'vue-props-unresolved' }),
    );
    expect(result.components.some((component) => component.name === 'Broken')).toBe(false);
    const broken = await extractVueComponents([join(root, 'Broken.vue')]);
    expect(broken.components).toEqual([]);
    expect(broken.extractionDiagnostics?.coverage).toBe('partial');
    expect(broken.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-sfc-parse-failed' }),
    );
  });

  it('retains TSX source occurrences, imported defaults, open domains and bound bracket access', async () => {
    const root = fixture({
      'props.ts': `export const shared = { 'quoted-key': { type: String, default: '' }, mixed: { type: [String, Number], required: true } };`,
      'Card.tsx': `import { defineComponent } from 'vue'; import { shared } from './props.js'; export const Card = defineComponent({ props: { ...shared, '$private': { type: Boolean, default: false } }, setup(_, { slots: actual }) { actual['heading']; actual[dynamic]; return () => <div/>; } });`,
    });
    const component = (await extractVueTsxComponents([join(root, 'Card.tsx')], undefined, { projectRoot: root }))
      .components[0]!;
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'quoted-key')).toMatchObject({
      sourceDefault: "''",
      facts: { origin: 'imported' },
    });
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'mixed')?.facts?.domain.openness).toBe(
      'open',
    );
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'heading')?.observations).toContainEqual(
      expect.objectContaining({ syntax: expect.objectContaining({ channel: 'slot-access' }) }),
    );
    expect(component.sourceCandidates?.some((candidate) => JSON.stringify(candidate).includes('dynamic-name'))).toBe(
      true,
    );
  });

  it('records cycles and unsupported computed keys without treating them as resolved empty objects', async () => {
    const root = fixture({
      'Unknown.vue': `<script setup lang="ts">const cycle = { ...cycle }; defineProps({ ...cycle, [dynamic]: String, ...missing }); defineSlots<unknown>();</script>`,
    });
    const result = await extractVueComponents([join(root, 'Unknown.vue')]);
    expect(result.extractionDiagnostics?.coverage).toBe('partial');
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-runtime-cycle' }),
    );
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-runtime-dynamic-key' }),
    );
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-slots-unresolved' }),
    );
  });

  it('keeps props and slots independent when either checker call throws', async () => {
    const root = fixture({
      'Throws.vue': `<script setup lang="ts">type Props = { label: string }; type Slots = { heading(): unknown }; defineProps<Props>(); defineSlots<Slots>();</script>`,
    });
    const original = Node.prototype.getType;
    vi.spyOn(Node.prototype, 'getType').mockImplementation(function (this: Node) {
      if (this.getText() === 'Props') throw new Error('generic checker failure');
      return original.call(this);
    });
    const result = await extractVueComponents([join(root, 'Throws.vue')]);
    expect(result.components[0]?.sourceCandidates?.some((candidate) => candidate.name === 'heading')).toBe(true);
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-props-throw' }),
    );
    vi.restoreAllMocks();
    vi.spyOn(Node.prototype, 'getType').mockImplementation(function (this: Node) {
      if (this.getText() === 'Slots') throw new Error('generic checker failure');
      return original.call(this);
    });
    const second = await extractVueComponents([join(root, 'Throws.vue')]);
    expect(second.components[0]?.sourceCandidates?.some((candidate) => candidate.name === 'label')).toBe(true);
    expect(second.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-slots-throw' }),
    );
  });

  it('does not mix setup access from sibling TSX components or resolve a shadowed macro/helper', async () => {
    const root = fixture({
      'Card.tsx': `import { defineComponent } from 'vue'; export const First = defineComponent({ setup(_, { slots }) { slots.first; return () => <div/>; } }); export const Second = defineComponent({ setup(_, { slots }) { slots.second; return () => <div/>; } });`,
      'Shadow.vue': `<script setup lang="ts">const defineProps = (value: unknown) => value; const defineSlots = (value: unknown) => value; defineProps({ pretend: String }); defineSlots<{ pretend(): unknown }>();</script>`,
    });
    const result = await extractVueTsxComponents([join(root, 'Card.tsx')]);
    expect(result.components.find((component) => component.name === 'First')?.slots.map((slot) => slot.name)).toEqual([
      'first',
    ]);
    expect(result.components.find((component) => component.name === 'Second')?.slots.map((slot) => slot.name)).toEqual([
      'second',
    ]);
    const shadow = await extractVueComponents([join(root, 'Shadow.vue')]);
    expect(shadow.components[0]?.sourceCandidates).toEqual([]);
    expect(shadow.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-macro-binding-unresolved' }),
    );
  });

  it('maps declaration offsets to exact original SFC bytes across both script blocks', async () => {
    const source = `<template><div>🙂</div></template>\n<script lang="ts">type Props = { label: string };</script>\n<script setup lang="ts">defineProps<Props>();</script>`;
    const root = fixture({ 'Mapped.vue': source });
    const result = await extractVueComponents([join(root, 'Mapped.vue')]);
    const location = result.components[0]!.sourceCandidates?.find((candidate) => candidate.name === 'label')
      ?.observations[0]?.location;
    expect(location).toMatchObject({
      startOffset: source.indexOf('label: string'),
      endOffset: source.indexOf('label: string') + 'label: string'.length,
    });
  });

  it('conserves existing helper projections as uncertain candidates when the runtime reader cannot resolve the call', async () => {
    const root = fixture({
      'Factory.tsx': `import { defineComponent } from 'vue'; import { propsFactory } from './helper.js'; const makeProps = propsFactory({ label: { type: String, default: 'safe' } }); export const Factory = defineComponent({ props: makeProps() });`,
      'helper.ts': `export function propsFactory(value: unknown) { return () => value; }`,
    });
    const component = (await extractVueTsxComponents([join(root, 'Factory.tsx')])).components[0]!;
    expect(component.props.find((prop) => prop.name === 'label')).toMatchObject({
      type: 'string',
      defaultValue: "'safe'",
    });
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'label')).toMatchObject({
      sourceDefault: "'safe'",
      facts: { certainty: 'unknown' },
    });
    expect(
      component.sourceCandidates?.some((candidate) =>
        candidate.observations.some(
          (observation) => observation.syntax?.reader === 'vue' && observation.syntax.resolution === 'unresolved',
        ),
      ),
    ).toBe(true);
  });
});
