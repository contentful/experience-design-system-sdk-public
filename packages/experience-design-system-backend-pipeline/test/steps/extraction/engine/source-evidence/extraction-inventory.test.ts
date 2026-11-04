import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  aggregateExtractionSourceInventory,
  captureSourceEvidence,
  discoverSourceEvidence,
  extractComponents,
  readSourceInventory,
} from '../../../../../src/steps/extraction/index.js';

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
  const result = await extractComponents(filePaths, undefined, { projectRoot: root, evidenceFilePaths: [] });
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

it('infers the common scan root across framework directories without expanding component roots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'extraction-inventory-root-'));
  roots.push(root);
  mkdirSync(join(root, 'react'));
  mkdirSync(join(root, 'vue'));
  const filePaths = [join(root, 'react', 'Surface.tsx'), join(root, 'vue', 'Panel.vue')];
  writeFileSync(filePaths[0]!, surface);
  writeFileSync(filePaths[1]!, panel);
  writeFileSync(join(root, 'react', 'Unselected.tsx'), 'export const Unselected = () => <div/>;');
  const result = await extractComponents(filePaths);
  expect(result.components.map((component) => component.name).sort()).toEqual(['Panel', 'Surface']);
  expect(result.sourceInventory?.projectRoot).toBe(realpathSync(root));
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths,
    inventory: result.sourceInventory,
    compilerSources: result.compilerSources,
  });
  expect(capture.files.some((file) => file.canonicalPath.endsWith('Unselected.tsx'))).toBe(true);
});

it('retains compiler-loaded bytes through full-scan aggregation after the source disappears', async () => {
  const root = mkdtempSync(join(tmpdir(), 'extraction-inventory-snapshot-'));
  roots.push(root);
  const filePaths = [join(root, 'Surface.tsx'), join(root, 'Context.md')];
  writeFileSync(filePaths[0]!, surface);
  writeFileSync(filePaths[1]!, '# Context');
  const result = await extractComponents(filePaths, undefined, { projectRoot: root, evidenceFilePaths: [] });
  rmSync(filePaths[0]!);
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths,
    inventory: result.sourceInventory,
    compilerSources: result.compilerSources,
  });
  expect(capture.files.find((file) => file.canonicalPath === realpathSync(root) + '/Surface.tsx')?.captured).toEqual({
    kind: 'full',
    text: surface,
  });
  expect(
    capture.diagnostics.some((item) => item.reason.startsWith('filesystem-unavailable-compiler-snapshot-used:')),
  ).toBe(true);
});

it('retains unavailable discovery identity for an aborted mixed scan without reading context', async () => {
  const root = mkdtempSync(join(tmpdir(), 'extraction-inventory-aborted-'));
  roots.push(root);
  const filePaths = [join(root, 'Surface.tsx'), join(root, 'Context.md')];
  writeFileSync(filePaths[0]!, surface);
  writeFileSync(filePaths[1]!, '# Context');
  const controller = new AbortController();
  controller.abort();
  const result = await extractComponents(filePaths, undefined, { projectRoot: root, signal: controller.signal });
  expect(result.sourceInventory?.selectedSourcePaths).toEqual(filePaths.map((path) => realpathSync(path)).sort());
  expect(result.sourceInventory?.coverage).toBe('unavailable');
  expect(result.sourceInventory?.files).toEqual([]);
  expect(result.sourceInventory?.bounds.used.readAttempts).toBe(0);
  expect(readSourceInventory(result.sourceInventory).status).toBe('available');
});

it('retains bounded adapter omission receipts without mutating the producer inventory', () => {
  const root = mkdtempSync(join(tmpdir(), 'extraction-inventory-receipts-'));
  roots.push(root);
  const filePaths = [join(root, 'Surface.tsx'), join(root, 'Context.md')];
  writeFileSync(filePaths[0]!, surface);
  writeFileSync(filePaths[1]!, '# Context');
  const producer = discoverSourceEvidence({ projectRoot: root, filePaths: [filePaths[0]!], limits: { maxFiles: 1 } });
  producer.omissions.push({ path: filePaths[0]!, reason: 'compiler-loaded-source-byte-or-file-budget' });
  const original = structuredClone(producer);
  const inventory = aggregateExtractionSourceInventory(
    filePaths,
    [{ components: [], warnings: [], sourceInventory: producer }],
    { projectRoot: root, evidenceFilePaths: [] },
  );
  expect(inventory?.omissions).toEqual(expect.arrayContaining(producer.omissions));
  expect(inventory?.coverage).toBe('partial');
  expect(inventory?.bounds.used.files).toBe(inventory?.files.length);
  expect(readSourceInventory(inventory).status).toBe('available');
  expect(producer).toEqual(original);
});
