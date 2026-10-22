import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { extractSvelteComponents as extractPublic } from '../../../src/steps/extraction/index.js';
import { extractSvelteComponents as extractBackend } from '../../../src/steps/extraction/src/framework-adapters/svelte/extract-svelte-components.js';
import { extractComponents } from '../../../src/index.js';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture(source: string, extra: Record<string, string> = {}, name = 'Panel.svelte') {
  const root = mkdtempSync(join(tmpdir(), 'scoreless-svelte-'));
  roots.push(root);
  for (const [path, content] of Object.entries({ [name]: source, ...extra })) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, path: join(root, name) };
}
for (const [name, extract] of [
  ['public', extractPublic],
  ['backend', extractBackend],
] as const) {
  it(`${name} Svelte retains unresolved review, clears only recovered type reason and never emits score`, async () => {
    const { root, path } = fixture(
      `<script lang="ts">import type { Base } from '@sample/base'; interface Props extends Base {} let { label }: Props = $props();</script><div>{label}</div>`,
      {
        'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@sample/*': ['types/*'] } } }),
        'types/base.ts': 'export interface Base { label: string }',
      },
    );
    const initial = (await extract([path], undefined, { projectRoot: root, resolveUnreachable: 'never' }))
      .components[0]!;
    expect(initial.reviewReasons).toContain('props-type-unresolved');
    expect(initial.needsReview).toBe(true);
    expect(initial).not.toHaveProperty('extractionConfidence');
    const recovered = (await extract([path], undefined, { projectRoot: root, resolveUnreachable: 'always' }))
      .components[0]!;
    expect(recovered.reviewReasons).not.toContain('props-type-unresolved');
    expect(recovered).not.toHaveProperty('extractionConfidence');
    expect(recovered.props).toContainEqual(expect.objectContaining({ name: 'label', type: 'string' }));
    const failed = fixture(
      '<script lang="ts">interface Props extends Missing {} let { label }: Props = $props();</script><div>{label}</div>',
    );
    const unresolved = (
      await extract([failed.path], undefined, { projectRoot: failed.root, resolveUnreachable: 'always' })
    ).components[0]!;
    expect(unresolved.reviewReasons).toContain('props-type-unresolved');
    expect(unresolved.needsReview).toBe(true);
    expect(unresolved).not.toHaveProperty('extractionConfidence');
  });
}
it.each([
  ['Panel.tsx', 'export function Panel({ label }: { label: string }) { return <div>{label}</div>; }'],
  [
    'Panel.vue',
    '<script setup lang="ts">defineProps<{ label: string }>();</script><template><div>{{ label }}</div></template>',
  ],
  [
    'panel.ts',
    "export class Panel extends HTMLElement { label: string = 'example'; } customElements.define('example-panel', Panel);",
  ],
  [
    'Panel.svelte',
    '<script lang="ts">interface Props { label: string } let { label }: Props = $props();</script><div>{label}</div>',
  ],
])('actual backend fresh %s extraction emits no score and preserves resolved inputs', async (name, source) => {
  const { root, path } = fixture(source!, {}, name!);
  const result = await extractComponents({
    filePaths: [path],
    projectRoot: root,
    opts: { resolveUnreachable: 'never' },
  });
  expect(result.components).toHaveLength(1);
  expect(result.components[0]).not.toHaveProperty('extractionConfidence');
  expect(result.components[0]!.props).toContainEqual(expect.objectContaining({ name: 'label', type: 'string' }));
});
