import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractVueComponents } from '../../../src/extract/framework-adapters/vue/extractor.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Vue SFC source candidates', () => {
  it('resolves imported setup declarations in a configured compiler context and preserves projected keys', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vue-source-candidates-'));
    temporaryDirectories.push(directory);
    writeFileSync(
      join(directory, 'props.ts'),
      `export type Props = { label: string; _internal: number; '$state': 'on' | 'off' };`,
    );
    const componentPath = join(directory, 'Card.vue');
    writeFileSync(
      componentPath,
      `<script setup lang="ts">\nimport type { Props } from './props.js';\nconst props = defineProps<Props>();\n</script>`,
    );

    const result = await extractVueComponents([componentPath]);
    const component = result.components.find((item) => item.name === 'Card')!;

    expect(component.sourceCandidates?.map((candidate) => candidate.name).sort()).toEqual([
      '$state',
      '_internal',
      'label',
    ]);
    expect(component.sourceCandidates?.find((candidate) => candidate.name === '_internal')?.projection.kind).toBe(
      'excluded',
    );
    expect(component.sourceCandidates?.find((candidate) => candidate.name === '$state')?.facts).toMatchObject({
      origin: 'imported',
      sourceTypeText: "'on' | 'off'",
      declarations: [
        { canonicalPath: resolve(directory, 'props.ts'), textHash: expect.any(String), binding: 'unverified' },
      ],
    });
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ specifier: './props.js', outcome: 'resolved' }),
    );
  });

  it('captures hidden Options API prop keys and exact local defaults with source locations', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vue-options-candidates-'));
    temporaryDirectories.push(directory);
    const componentPath = join(directory, 'Notice.vue');
    writeFileSync(
      componentPath,
      `<script lang="ts">\nexport default {\n  props: {\n    _internal: { type: String },\n    message: { type: String, required: true, default: "ready" },\n  },\n};\n</script>`,
    );

    const result = await extractVueComponents([componentPath]);
    const component = result.components.find((item) => item.name === 'Notice')!;
    const message = component.sourceCandidates?.find((candidate) => candidate.name === 'message');

    expect(component.props.some((prop) => prop.name === '_internal')).toBe(false);
    expect(component.sourceCandidates?.find((candidate) => candidate.name === '_internal')?.projection.kind).toBe(
      'excluded',
    );
    expect(message?.facts).toMatchObject({
      origin: 'own',
      sourceDefault: { expression: '"ready"' },
      declarations: [{ canonicalPath: resolve(componentPath), textHash: expect.any(String), startLine: 5 }],
    });
  });

  it('retains imported Options API props with their declaring SFC origin and bytes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vue-inherited-candidates-'));
    temporaryDirectories.push(directory);
    const basePath = join(directory, 'Base.vue');
    writeFileSync(
      basePath,
      `<script lang="ts">\nexport default {\n  props: {\n    _baseKey: { type: String, default: 'base' },\n    inheritedLabel: { type: String, required: true },\n  },\n};\n</script>`,
    );
    const componentPath = join(directory, 'Notice.vue');
    writeFileSync(
      componentPath,
      `<script lang="ts">\nimport Base from './Base.vue';\nexport default {\n  extends: Base,\n  props: { localLabel: { type: String } },\n};\n</script>`,
    );

    const result = await extractVueComponents([componentPath]);
    const component = result.components.find((item) => item.name === 'Notice')!;
    const inherited = component.sourceCandidates?.find((candidate) => candidate.name === 'inheritedLabel');
    const hidden = component.sourceCandidates?.find((candidate) => candidate.name === '_baseKey');

    expect(component.props.some((prop) => prop.name === 'inheritedLabel')).toBe(true);
    expect(component.props.some((prop) => prop.name === '_baseKey')).toBe(false);
    expect(hidden?.projection.kind).toBe('excluded');
    expect(inherited?.facts).toMatchObject({
      origin: 'imported',
      declarations: [{ canonicalPath: resolve(basePath), textHash: expect.any(String), binding: 'unverified' }],
    });
  });

  it('reports imported Options API traversal when its depth budget is exhausted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vue-import-budget-'));
    temporaryDirectories.push(directory);
    const files = Array.from({ length: 66 }, (_, index) => join(directory, `Layer${index}.vue`));
    files.forEach((filePath, index) => {
      const nextImport = index < files.length - 1 ? `import Next from './Layer${index + 1}.vue';` : '';
      const extendsOption = index < files.length - 1 ? 'extends: Next,' : '';
      writeFileSync(
        filePath,
        `<script lang="ts">\n${nextImport}\nexport default { ${extendsOption} props: { layer${index}: { type: String } } };\n</script>`,
      );
    });

    const result = await extractVueComponents([files[0]!]);
    const component = result.components.find((item) => item.name === 'Layer0')!;

    expect(component.sourceCandidates?.some((candidate) => candidate.name === 'layer63')).toBe(true);
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({
        specifier: 'Next',
        outcome: 'unavailable',
        reason: 'vue-options-extends-depth-budget-exhausted',
      }),
    );
    expect(result.extractionDiagnostics?.limits.maxVueImportedDepth).toBe(64);
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
