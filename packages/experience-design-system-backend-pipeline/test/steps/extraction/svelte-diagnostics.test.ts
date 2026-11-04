import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractEndpoint } from '../../../src/steps/extraction/index.js';
import { extractComponents } from '../../../src/index.js';

const roots: string[] = [];
function fixture(files: Record<string, string>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'svelte-diagnostics-')));
  roots.push(root);
  const filePaths = Object.entries(files).map(([name, source]) => {
    const path = join(root, name);
    writeFileSync(path, source);
    return path;
  });
  return { root, filePaths };
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const exportedLet = '<script>export let label = "Hello";</script><p>{label}</p>';
const propsCall =
  '<script lang="ts">interface Props { label?: string } let { label = "Hello" }: Props = $props();</script><p>{label}</p>';
const unresolved =
  '<script lang="ts">interface Props extends Missing {} let { label }: Props = $props();</script><p>{label}</p>';
const warning = (path: string) =>
  `Example: Svelte export let props are not extracted; prop extraction uses $props() syntax; this component was skipped (${path})`;
const producers = [
  {
    name: 'public',
    extract: (filePaths: string[], projectRoot: string, mode: 'never' | 'auto' = 'never') =>
      extractEndpoint({ filePaths, projectRoot, resolveUnreachable: mode }),
  },
  {
    name: 'backend',
    extract: (filePaths: string[], projectRoot: string, mode: 'never' | 'auto' = 'never') =>
      extractComponents({ filePaths, projectRoot, opts: { resolveUnreachable: mode } }),
  },
];

for (const { name, extract } of producers) {
  describe(`${name} Svelte syntax diagnostics`, () => {
    it('retains a useful generic warning when exported-let syntax emits no component', async () => {
      const { root, filePaths } = fixture({ 'Example.svelte': exportedLet });
      const result = await extract(filePaths, root);
      expect(result.components).toEqual([]);
      expect(result.warnings).toEqual([warning(filePaths[0]!)]);
      expect(result.warnings.join('\n')).not.toMatch(/\b[A-Z][A-Z0-9]+-\d+\b/);
    });

    it('keeps baseline props-call extraction supported without a skipped-syntax warning', async () => {
      const { root, filePaths } = fixture({ 'Supported.svelte': propsCall });
      const result = await extract(filePaths, root);
      expect(result.components).toHaveLength(1);
      expect(result.components[0]).toMatchObject({
        name: 'Supported',
        framework: 'svelte',
        props: [expect.objectContaining({ name: 'label', type: 'string', required: false })],
      });
      expect(result.warnings).toEqual([]);
    });

    it('retains the skip warning alongside emitted components and a distinct parse error', async () => {
      const { root, filePaths } = fixture({
        'Example.svelte': exportedLet,
        'Supported.svelte': propsCall,
        'Malformed.svelte': '<script>let =</script>',
      });
      const result = await extract(filePaths, root);
      expect(result.components.map((component) => component.name)).toEqual(['Supported']);
      expect(result.warnings).toContain(warning(join(root, 'Example.svelte')));
      expect(result.warnings).toContainEqual(
        expect.stringContaining(`Malformed: parse error in ${join(root, 'Malformed.svelte')}`),
      );
      expect(result.warnings.filter((item) => item.includes('this component was skipped'))).toHaveLength(1);
    });

    it.each(['never', 'auto'] as const)(
      'keeps the skip warning when declared-Props diagnostics collapse (retry=%s)',
      async (mode) => {
        const { root, filePaths } = fixture({
          'Example.svelte': exportedLet,
          'First.svelte': unresolved,
          'Second.svelte': unresolved,
          'Third.svelte': unresolved,
        });
        const result = await extract(filePaths, root, mode);
        expect(result.components.some((component) => component.name === 'Example')).toBe(false);
        expect(result.warnings).toContain(warning(join(root, 'Example.svelte')));
        expect(result.warnings).toContainEqual(expect.stringContaining('Unresolved component types: 3 components'));
        expect(result.warnings.some((item) => /declared Props type .* resolved to/.test(item))).toBe(false);
      },
    );
  });
}
