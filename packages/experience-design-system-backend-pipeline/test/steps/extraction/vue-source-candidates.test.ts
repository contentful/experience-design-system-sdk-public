import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractVueComponents } from '../../../src/steps/extraction/src/framework-adapters/vue/extract-vue-components.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('backend Vue SFC source candidates', () => {
  it('uses the shared compiler-context owner for imported script setup declarations', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'backend-vue-source-candidates-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, 'props.ts'), `export type Props = { label: string; _internal: number };`);
    const componentPath = join(directory, 'Card.vue');
    writeFileSync(
      componentPath,
      `<script setup lang="ts">\nimport type { Props } from './props.js';\nconst props = defineProps<Props>();\n</script>`,
    );

    const result = await extractVueComponents([componentPath]);
    const component = result.components.find((item) => item.name === 'Card')!;

    expect(component.sourceCandidates?.map((candidate) => candidate.name).sort()).toEqual(['_internal', 'label']);
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'label')?.facts).toMatchObject({
      origin: 'imported',
      declarations: [{ canonicalPath: resolve(directory, 'props.ts'), textHash: expect.any(String) }],
    });
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ specifier: './props.js', outcome: 'resolved' }),
    );
  });

  it('preserves imported Options API declarations through the backend SFC producer', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'backend-vue-options-candidates-'));
    temporaryDirectories.push(directory);
    const basePath = join(directory, 'Base.vue');
    writeFileSync(
      basePath,
      `<script lang="ts">\nexport default {\n  props: {\n    _baseKey: { type: String },\n    inheritedLabel: { type: String, required: true },\n  },\n};\n</script>`,
    );
    const componentPath = join(directory, 'Notice.vue');
    writeFileSync(
      componentPath,
      `<script lang="ts">\nimport Base from './Base.vue';\nexport default { extends: Base, props: { localLabel: { type: String } } };\n</script>`,
    );

    const result = await extractVueComponents([componentPath]);
    const component = result.components.find((item) => item.name === 'Notice')!;
    const inherited = component.sourceCandidates?.find((candidate) => candidate.name === 'inheritedLabel');

    expect(component.sourceCandidates?.find((candidate) => candidate.name === '_baseKey')?.projection.kind).toBe(
      'excluded',
    );
    expect(inherited?.facts).toMatchObject({
      origin: 'imported',
      declarations: [{ canonicalPath: resolve(basePath), textHash: expect.any(String) }],
    });
  });
  it('preserves literal Options keys as semantic source segments', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vue-literal-keys-'));
    temporaryDirectories.push(directory);
    const componentPath = join(directory, 'Notice.vue');
    writeFileSync(
      componentPath,
      `<script lang="ts">export default { props: {
      'a.b/c': { type: String }, ['__proto__']: { type: String },
      constructor: { type: String }, '0': { type: Number },
      'quote\\"key': { type: String },
    } };</script>`,
    );
    const result = await extractVueComponents([componentPath]);
    const component = result.components.find((item) => item.name === 'Notice')!;
    const own = component.sourceCandidates?.filter((candidate) => candidate.facts?.origin === 'own');
    expect(own?.map((candidate) => candidate.name).sort()).toEqual(
      ['a.b/c', '__proto__', 'constructor', '0', 'quote"key'].sort(),
    );
    expect(own?.find((candidate) => candidate.name === 'a.b/c')?.keyPath).toEqual(['a.b/c']);
    expect(own?.find((candidate) => candidate.name === '__proto__')?.keyPath).toEqual(['__proto__']);
  });
});
