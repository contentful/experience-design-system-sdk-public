import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as api from '../../../../../src/steps/extraction/index.js';
import { createCompilerContexts } from '../../../../../src/steps/extraction/src/compiler/context.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'source-inventory-'));
  roots.push(root);
  mkdirSync(join(root, 'examples'));
  writeFileSync(join(root, 'Surface.tsx'), 'export const Surface = () => <section />;');
  writeFileSync(
    join(root, 'examples', 'Use.test.tsx'),
    'import {Surface} from "../Surface"; const Example = () => <Surface />;',
  );
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'example-package',
      version: '1.2.3',
      packageManager: 'example@1',
      scripts: { build: 'example build' },
    }),
  );
  writeFileSync(
    join(root, 'Surface.js.map'),
    JSON.stringify({
      version: 3,
      file: 'Surface.js',
      sources: ['Surface.tsx', 'missing.tsx'],
      sourcesContent: [null, 'embedded source'],
    }),
  );
  return root;
}
it('admits bounded context and literal provenance independently of selected output roots', () => {
  expect(api.discoverSourceEvidence).toBeTypeOf('function');
  const root = fixture();
  const result = api.discoverSourceEvidence({ projectRoot: root, filePaths: [join(root, 'Surface.tsx')] });
  expect(result.selectedSourcePaths).toEqual([realpathSync(join(root, 'Surface.tsx'))]);
  expect(result.files.some((item) => item.canonicalPath.endsWith('Use.test.tsx'))).toBe(true);
  expect(result.packages[0]?.name).toBe('example-package');
  expect(result.sourceMaps[0]?.sources.map((item) => item.status)).toEqual(['file', 'embedded']);
  expect(result.sourceMaps[0]?.sources[1]?.textHash).toMatch(/^[a-f0-9]{64}$/);
});
it('discloses directory/file bounds, unsupported and outside symlinks without scanning dependencies', () => {
  expect(api.discoverSourceEvidence).toBeTypeOf('function');
  const root = fixture();
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'hidden.tsx'), 'ignored');
  symlinkSync(tmpdir(), join(root, 'escape'));
  writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 255]));
  const result = api.discoverSourceEvidence({ projectRoot: root, filePaths: [], limits: { maxFiles: 1 } });
  expect(result.coverage).toBe('partial');
  expect(result.omissions.some((item) => item.reason === 'max-files')).toBe(true);
  expect(result.files.every((item) => !item.canonicalPath.includes('node_modules'))).toBe(true);
});

it('collects nearest literal package metadata with explicit evidence paths and canonical deduplication', () => {
  const root = fixture();
  const selected = join(root, 'Surface.tsx');
  symlinkSync(selected, join(root, 'linked.tsx'));
  const inventory = api.discoverSourceEvidence({
    projectRoot: root,
    filePaths: [selected, join(root, 'linked.tsx')],
    evidenceFilePaths: [join(root, 'examples', 'Use.test.tsx')],
  });
  expect(inventory.selectedSourcePaths).toHaveLength(1);
  expect(inventory.files.filter((file) => file.canonicalPath === realpathSync(selected))).toHaveLength(1);
  expect(inventory.packages[0]?.scripts.build).toBe('example build');
  expect(api.readSourceInventory(inventory).status).toBe('available');
});
it('retains unsupported maps, missing metadata fields and unavailable source relationships', () => {
  const root = fixture();
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, 'bad.map'), '{');
  writeFileSync(join(root, 'unsupported.map'), JSON.stringify({ version: 99, sources: [] }));
  writeFileSync(join(root, 'missing.map'), JSON.stringify({ version: 3, sources: ['absent.tsx'] }));
  const inventory = api.discoverSourceEvidence({ projectRoot: root, filePaths: [join(root, 'Surface.tsx')] });
  expect(inventory.packages[0]?.missing).toEqual(['name', 'version', 'packageManager', 'scripts']);
  expect(inventory.sourceMaps.map((map) => map.status)).toEqual(expect.arrayContaining(['invalid', 'unsupported']));
  expect(inventory.sourceMaps.find((map) => map.path.endsWith('/missing.map'))?.sources[0]?.status).toBe('unavailable');
  expect(api.readSourceInventory(inventory).status).toBe('available');
});
it.each([
  { maxFileBytes: 1 },
  { maxTotalBytes: 1 },
  { maxReadAttempts: 0 },
  { maxDirectories: 0 },
  { maxDirectoryEntries: 0 },
  { maxDepth: 0 },
])('discloses each declared discovery budget %j', (limits) => {
  const root = fixture();
  const inventory = api.discoverSourceEvidence({ projectRoot: root, filePaths: [join(root, 'Surface.tsx')], limits });
  expect(inventory.omissions.length).toBeGreaterThan(0);
  expect(inventory.coverage).not.toBe('complete-within-declared-bound');
  expect(api.readSourceInventory(inventory).status).toBe('available');
});
it('excludes escaping symlinks, binary text, unavailable files and installed trees with precise causes', () => {
  const root = fixture();
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'node_modules', 'hidden.tsx'), 'ignored');
  symlinkSync(tmpdir(), join(root, 'escape'));
  writeFileSync(join(root, 'binary.txt'), Buffer.from([0, 1]));
  const inventory = api.discoverSourceEvidence({ projectRoot: root, filePaths: [join(root, 'absent.tsx')] });
  expect(inventory.omissions.map((item) => item.reason)).toEqual(
    expect.arrayContaining([
      'outside-project-root',
      'unsupported-binary-content',
      'source-unavailable',
      'dependency-or-git-tree-excluded',
    ]),
  );
});
it('rejects unsupported schema, wrong inventory bytes, duplicate paths, malformed maps and metadata fingerprints', () => {
  const root = fixture();
  const inventory = api.discoverSourceEvidence({ projectRoot: root, filePaths: [join(root, 'Surface.tsx')] });
  expect(api.readSourceInventory({ ...inventory, schemaVersion: 9 }).status).toBe('unsupported');
  const bytes = structuredClone(inventory);
  bytes.files[0]!.text += 'changed';
  expect(api.readSourceInventory(bytes).status).toBe('corrupt');
  const metadata = structuredClone(inventory);
  metadata.packages[0]!.textHash = '0'.repeat(64);
  expect(api.readSourceInventory(metadata).status).toBe('corrupt');
  const map = structuredClone(inventory);
  map.sourceMaps[0]!.sources[0]!.textHash = '0'.repeat(64);
  expect(api.readSourceInventory(map).status).toBe('corrupt');
  const counts = structuredClone(inventory);
  counts.bounds.used.readAttempts = -1;
  expect(api.readSourceInventory(counts).status).toBe('corrupt');
});
it('captures exact producer bytes after live text changes or disappears, with explicit fallback receipts', async () => {
  const root = fixture();
  const path = join(root, 'Surface.tsx');
  const produced = await api.extractReactComponents([path], undefined, { projectRoot: root, evidenceFilePaths: [] });
  const source = produced.compilerSources!.find((source) => source.path === realpathSync(path))!;
  writeFileSync(path, 'export const Surface=()=> <aside/>;');
  const changed = await api.captureSourceEvidence({
    projectRoot: root,
    filePaths: [path],
    inventory: produced.sourceInventory,
    compilerSources: produced.compilerSources,
  });
  expect(changed.files.find((file) => file.canonicalPath === source.path)?.textHash).toBe(source.textHash);
  expect(changed.diagnostics.some((item) => item.reason.startsWith('filesystem-differs-from-compiler:'))).toBe(true);
  rmSync(path);
  const absent = await api.captureSourceEvidence({
    projectRoot: root,
    filePaths: [path],
    inventory: produced.sourceInventory,
    compilerSources: produced.compilerSources,
  });
  expect(absent.files.find((file) => file.canonicalPath === source.path)?.captured).toEqual({
    kind: 'full',
    text: source.content,
  });
  expect(
    absent.diagnostics.some((item) => item.reason.startsWith('filesystem-unavailable-compiler-snapshot-used:')),
  ).toBe(true);
  await expect(
    api.captureSourceEvidence({
      projectRoot: root,
      filePaths: [path],
      inventory: produced.sourceInventory,
      compilerSources: [{ ...source, textHash: '0'.repeat(64) }],
    }),
  ).rejects.toThrow('Invalid compiler source hash');
});

it('rejects a valid inventory attached to different selected roots before capturing evidence', async () => {
  const root = fixture();
  const selected = join(root, 'Surface.tsx');
  const inventory = api.discoverSourceEvidence({ projectRoot: root, filePaths: [selected] });
  await expect(api.captureSourceEvidence({ projectRoot: root, filePaths: [], inventory })).rejects.toThrow(
    'selected-root identity',
  );
});

it('keeps compiler cancellation cooperative without performing source discovery', () => {
  const root = fixture();
  const selected = realpathSync(join(root, 'Surface.tsx'));
  const controller = new AbortController();
  controller.abort();
  const result = createCompilerContexts([selected], /\.tsx$/, { projectRoot: root, signal: controller.signal });
  expect(result.contexts).toEqual([]);
  expect(result.sourceInventory).toMatchObject({
    selectedSourcePaths: [selected],
    files: [],
    packages: [],
    sourceMaps: [],
    coverage: 'unavailable',
    omissions: [{ path: realpathSync(root), reason: 'source-discovery-aborted' }],
    bounds: { used: { files: 0, totalBytes: 0, directories: 0, directoryEntries: 0, readAttempts: 0 } },
  });
  expect(api.readSourceInventory(result.sourceInventory).status).toBe('available');
  expect(result.diagnostics.projects).toContainEqual(
    expect.objectContaining({ diagnostics: ['compiler-analysis-aborted'] }),
  );
});

it('preserves explicit cancellation rejection for direct discovery and capture', async () => {
  const root = fixture();
  const controller = new AbortController();
  controller.abort();
  const request = { projectRoot: root, filePaths: [join(root, 'Surface.tsx')], signal: controller.signal };
  expect(() => api.discoverSourceEvidence(request)).toThrow(expect.objectContaining({ name: 'AbortError' }));
  await expect(api.captureSourceEvidence(request)).rejects.toMatchObject({ name: 'AbortError' });
});
