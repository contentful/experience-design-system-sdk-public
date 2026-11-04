import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadComponentSourceRef } from '../../src/index.js';

it('retains full source and every discovered sibling for agent prompts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'source-ref-completeness-'));
  try {
    const paths = Array.from({ length: 8 }, (_, index) => join(root, `sibling-${index}.ts`));
    const siblings = paths.map((_, index) => `export const value${index} = "${'é'.repeat(6000)}";`);
    paths.forEach((path, index) => writeFileSync(path, siblings[index]!));
    const source =
      paths.map((_, index) => `import { value${index} } from './sibling-${index}';`).join('\n') +
      '\n' +
      'const padding = "' +
      'é'.repeat(10_000) +
      '";\nexport const Example = () => padding;';
    const path = join(root, 'example.tsx');
    writeFileSync(path, source);
    const ref = await loadComponentSourceRef('Example', path, ['padding'], ['string']);
    expect(ref.content).toBe(source);
    expect(ref.siblingFiles).toEqual(paths.map((path, index) => ({ path, content: siblings[index] })));
    expect(ref.truncatedSiblingCount ?? 0).toBe(0);
    expect(ref.usesNotShown ?? []).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('keeps a missing source explicitly unavailable', async () => {
  expect(await loadComponentSourceRef('Example', '/nonexistent-example/example.tsx')).toEqual({
    component: 'Example',
    sourcePath: '/nonexistent-example/example.tsx',
    content: null,
  });
});
