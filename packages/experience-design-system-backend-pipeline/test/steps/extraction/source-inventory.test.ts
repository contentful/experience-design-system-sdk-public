import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { captureSourceEvidence, readSourceInventory } from '../../../src/steps/extraction/index.js';
import { extractComponents } from '../../../src/steps/extraction/src/controller/extract-components-endpoint.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const surface = 'export const Surface = () => <section />;';
const panel =
  '<script setup lang="ts">defineProps<{ label: string }>();</script><template><aside>{{ label }}</aside></template>';

it.each([
  {
    sources: {
      'Surface.tsx': surface,
      'helper.ts': 'export const helper = true;',
      'index.ts': 'export { Surface } from "./Surface";',
    },
    names: ['Surface'],
  },
  { sources: { 'Surface.tsx': surface, 'Panel.vue': panel }, names: ['Panel', 'Surface'] },
  {
    sources: { 'Surface.tsx': surface, 'Context.md': '# Context', 'data.json': '{"label":"sample"}' },
    names: ['Surface'],
  },
  { sources: { 'Panel.vue': panel }, names: ['Panel'] },
  { sources: { 'Context.md': '# Context', 'data.json': '{"label":"sample"}' }, names: [] },
])('retains full selected identity while extracting only components: $sources', async ({ sources, names }) => {
  const root = mkdtempSync(join(tmpdir(), 'extraction-inventory-'));
  roots.push(root);
  const filePaths = Object.entries(sources).map(([name, text]) => {
    const path = join(root, name);
    writeFileSync(path, text!);
    return path;
  });
  const result = await extractComponents({ filePaths, projectRoot: root, opts: { evidenceFilePaths: [] } });
  expect(result.components.map((component) => component.name).sort()).toEqual(names);
  expect(result.sourceInventory?.selectedSourcePaths).toEqual(filePaths.map((path) => realpathSync(path)).sort());
  expect(readSourceInventory(result.sourceInventory).status).toBe('available');
  expect(
    result.sourceInventory?.files
      .filter((file) => file.roles.includes('selected'))
      .map((file) => file.canonicalPath)
      .sort(),
  ).toEqual(filePaths.map((path) => realpathSync(path)).sort());
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths,
    inventory: result.sourceInventory,
    compilerSources: result.compilerSources,
  });
  expect(capture.inventory?.selectedSourcePaths).toEqual(filePaths.map((path) => realpathSync(path)).sort());
});
