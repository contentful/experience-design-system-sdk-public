import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bindSourceCandidatesToCapture,
  extractVueComponents as publicSfc,
  extractVueTsxComponents as publicTsx,
} from '@contentful/experience-design-system-extraction';
import { extractVueComponents } from '../../../src/steps/extraction/src/framework-adapters/vue/extract-vue-components.js';
import { extractVueTsxComponents } from '../../../src/steps/extraction/src/framework-adapters/vue-tsx/extract-vue-tsx-components.js';
import {
  isSourceCandidatePayload,
  isExtractionDiagnosticsPayload,
} from '../../../src/persistence/src/session/repositories/source-evidence-validation.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function fixture(files: Record<string, string>): string {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'backend-vue-reader-')));
  directories.push(directory);
  for (const [name, source] of Object.entries(files)) writeFileSync(join(directory, name), source);
  return directory;
}

describe('actual backend shared Vue producers', () => {
  it('does not invent an owning name or props from shadowed Options macros', async () => {
    const root = fixture({
      'ShadowOptions.vue': `<script setup lang="ts">const defineOptions = (value: unknown) => value; defineOptions({ name: 'Pretend', props: { invented: String } });</script>`,
    });
    const result = await extractVueComponents([join(root, 'ShadowOptions.vue')]);
    expect(result).toEqual(await publicSfc([join(root, 'ShadowOptions.vue')]));
    expect(result.components[0]).toMatchObject({ name: 'ShadowOptions', props: [], sourceCandidates: [] });
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-macro-binding-unresolved' }),
    );
  });

  it('delivers conservative option metadata and actual slot binding through SFC and TSX runtime adapters', async () => {
    const options = `{ literal: { type: Number, type: String, required: true, required: false, default: 0, default: '' }, uncertain: { type: String, required: true, default: 'first', ...unknownOptions } }`;
    const setup = `setup() { const useSlots = () => ({ pretend: () => '' }); const actual = useSlots(); actual.pretend; return () => null; }`;
    const root = fixture({
      'Options.vue': `<script lang="ts">import { useSlots } from 'vue'; export default { props: ${options}, ${setup} };</script>`,
      'Options.tsx': `import { useSlots, defineComponent } from 'vue'; export const Options = defineComponent({ props: ${options}, ${setup} });`,
    });
    for (const [name, extract, direct] of [
      ['Options.vue', extractVueComponents, publicSfc],
      ['Options.tsx', extractVueTsxComponents, publicTsx],
    ] as const) {
      const result = await extract([join(root, name)]);
      expect(result).toEqual(await direct([join(root, name)]));
      const component = result.components[0]!;
      expect(component.props.find((prop) => prop.name === 'literal')).toMatchObject({
        type: 'string',
        required: false,
        defaultValue: "''",
      });
      expect(component.sourceCandidates?.find((candidate) => candidate.name === 'uncertain')).toMatchObject({
        type: 'unknown',
        declaredRequired: null,
        sourceDefault: null,
      });
      expect(component.slots).toEqual([]);
      expect(component.sourceCandidates?.some((candidate) => candidate.name === 'pretend')).toBe(false);
      expect(isSourceCandidatePayload(component.sourceCandidates)).toBe(true);
      expect(result.extractionDiagnostics?.modules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: 'vue-runtime-options-unresolved' }),
          expect.objectContaining({ reason: 'vue-slots-binding-unresolved' }),
        ]),
      );
    }
  });

  it('forwards configured analysis and preserves SFC occurrences, source identity and slot uncertainty', async () => {
    const files = {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true, baseUrl: '.', paths: { '@props': ['./props.ts'] } },
      }),
      'props.ts': `export type Props = { 'a.b/c': string; zero: number }; export const runtime = { collisions: { type: String, default: 'before' } };`,
      'Card.vue': `<script lang="ts">import type { Props } from '@props'; export default { name: 'DeclaredCard' };</script>\n<script setup lang="ts">const { zero: count = 0 } = defineProps<Props>(); defineSlots<{ heading?: () => unknown }>();</script>\n<template><slot v-if="visible" name="heading"/><slot :name="dynamic"/></template>`,
    };
    const root = fixture(files);
    const path = join(root, 'Card.vue');
    const progress: unknown[] = [];
    const result = await extractVueComponents([path, join(root, 'props.ts')], (event) => progress.push(event), {
      projectRoot: root,
    });
    const expected = await publicSfc([path], undefined, { projectRoot: root });
    expect(result).toEqual(expected);
    expect(progress).toEqual([{ filesProcessed: 1, componentsFound: 1 }]);
    expect(result.components[0]!.name).toBe('DeclaredCard');
    expect(result.extractionDiagnostics?.projects[0]?.configPath).toBe(join(root, 'tsconfig.json'));
    const bound = bindSourceCandidatesToCapture(
      result.components,
      Object.entries(files).map(([name, source]) => ({
        canonicalPath: join(root, name),
        textHash: createHash('sha256').update(source).digest('hex'),
      })),
    );
    expect(isSourceCandidatePayload(bound[0]!.sourceCandidates)).toBe(true);
    expect(isExtractionDiagnosticsPayload(result.extractionDiagnostics)).toBe(true);
    expect(bound[0]!.sourceCandidates?.find((candidate) => candidate.name === 'zero')).toMatchObject({
      sourceDefault: '0',
      observations: [
        expect.objectContaining({
          location: expect.objectContaining({ binding: 'verified' }),
          syntax: expect.objectContaining({
            default: expect.objectContaining({ locations: [expect.objectContaining({ binding: 'verified' })] }),
          }),
        }),
      ],
    });
    expect(
      bound[0]!.sourceCandidates?.find((candidate) => candidate.name === 'heading')?.observations[0]?.syntax
        ?.typeLocations[0]?.binding,
    ).toBe('verified');
    const stale = bindSourceCandidatesToCapture(result.components, [{ canonicalPath: path, textHash: 'changed' }]);
    expect(
      stale[0]!.sourceCandidates?.find((candidate) => candidate.name === 'heading')?.observations[0]?.location?.binding,
    ).toBe('changed');
    expect(
      isSourceCandidatePayload([
        {
          ...bound[0]!.sourceCandidates![0],
          observations: [
            { ...bound[0]!.sourceCandidates![0]!.observations[0], syntax: { reader: 'vue', occurrence: 'invalid' } },
          ],
        },
      ]),
    ).toBe(false);
  });

  it('uses the same TSX runtime/import and slot contract reader without emitting support components', async () => {
    const root = fixture({
      'props.ts': `export const shared = { key: { type: String, default: 'first' }, '_private': Boolean }; export interface Slots { heading?: () => unknown }`,
      'Card.tsx': `import { shared, type Slots } from './props.js'; import { genericComponent } from './helper.js'; export const Card = genericComponent<Slots>()({ props: { key: Number, ...shared, key: { type: Boolean, default: false } }, setup(_, { slots: actual }) { actual['footer']; actual[dynamic]; return () => <div/>; } });`,
      'helper.ts': `export function genericComponent<T>() { return (options: unknown) => options; }`,
    });
    const paths = ['Card.tsx', 'props.ts', 'helper.ts'].map((path) => join(root, path));
    const result = await extractVueTsxComponents(paths, undefined, { projectRoot: root });
    expect(result).toEqual(await publicTsx(paths, undefined, { projectRoot: root }));
    expect(result.components.map((component) => component.name)).toEqual(['Card']);
    const component = result.components[0]!;
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'key')).toMatchObject({
      facts: { certainty: 'ambiguous' },
    });
    expect(component.props.find((prop) => prop.name === 'key')).toMatchObject({
      type: 'boolean',
      defaultValue: 'false',
    });
    expect(component.slots.map((slot) => slot.name)).toEqual(['footer', 'heading']);
    expect(isSourceCandidatePayload(component.sourceCandidates)).toBe(true);
  });

  it('retains diagnostics for zero components and cooperative cancellation', async () => {
    const root = fixture({
      'Broken.vue': '<script setup>const = ;</script><template><div></template>',
      'Valid.vue': '<script setup>defineProps({ label: String });</script>',
    });
    const failed = await extractVueComponents([join(root, 'Broken.vue')]);
    expect(failed.components).toEqual([]);
    expect(failed.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-sfc-parse-failed' }),
    );
    const controller = new AbortController();
    controller.abort();
    const cancelled = await extractVueComponents([join(root, 'Valid.vue')], undefined, {
      signal: controller.signal,
      projectRoot: root,
    });
    expect(cancelled.components).toEqual([]);
    expect(cancelled.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'vue-analysis-cancelled' }),
    );
    expect(isExtractionDiagnosticsPayload(cancelled.extractionDiagnostics)).toBe(true);
  });
  it('retains symbol-backed member props and aliased slot accesses through both actual adapters', async () => {
    const options = `{ props: { ...values.group['nested'], ...values.direct }, setup(_, context) { const alias = context; const slots = alias['slots']; const again = slots; again['footer']; again[dynamic]; function unrelated(again: any) { again.pretend; } return () => null; } }`;
    const root = fixture({
      'props.ts': `export const group = { nested: { label: { type: String, default: '' } } }; export const direct = { enabled: Boolean };`,
      'Members.vue': `<script lang="ts">import * as values from './props.js'; export default ${options};</script>`,
      'Members.tsx': `import * as values from './props.js'; import { defineComponent } from 'vue'; export const Members = defineComponent(${options});`,
    });
    for (const [name, extract, direct] of [
      ['Members.vue', extractVueComponents, publicSfc],
      ['Members.tsx', extractVueTsxComponents, publicTsx],
    ] as const) {
      const result = await extract([join(root, name)], undefined, { projectRoot: root });
      expect(result).toEqual(await direct([join(root, name)], undefined, { projectRoot: root }));
      const component = result.components[0]!;
      expect(component.sourceCandidates?.find((candidate) => candidate.name === 'label')).toMatchObject({
        sourceDefault: "''",
        facts: { origin: 'imported' },
      });
      expect(component.slots.map((slot) => slot.name)).toEqual(['footer']);
      expect(component.sourceCandidates?.some((candidate) => candidate.name === 'pretend')).toBe(false);
      expect(isSourceCandidatePayload(component.sourceCandidates)).toBe(true);
      expect(isExtractionDiagnosticsPayload(result.extractionDiagnostics)).toBe(true);
    }
  });
});
