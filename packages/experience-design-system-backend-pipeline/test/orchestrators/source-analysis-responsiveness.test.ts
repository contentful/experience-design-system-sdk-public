import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { extractComponentsWithCache } from '../../src/orchestrators/run-extract-and-compose-session/helpers/extract-components-with-cache.js';
import { extractComponents } from '../../src/steps/extraction/src/controller/extract-components-endpoint.js';

let root: string;
let db: DatabaseSync;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'source-responsiveness-')));
  db = new DatabaseSync(':memory:');
  writeFileSync(
    join(root, 'Surface.tsx'),
    'export const Surface = ({ label }: {label: string}) => <section>{label}</section>;',
  );
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const request = (signal?: AbortSignal) => ({
  db,
  sourceFiles: [join(root, 'Surface.tsx')],
  evidenceFilePaths: [],
  projectPath: root,
  cacheVersion: 'test',
  noCache: true,
  resolveUnreachable: 'never' as const,
  signal,
});

it('allows UI timers to run before compiler extraction completes', async () => {
  const heartbeat = new Promise<string>((resolve) => setTimeout(() => resolve('heartbeat'), 0));
  const work = extractComponentsWithCache(request());
  const first = await Promise.race([work.then(() => 'extracted'), heartbeat]);
  const result = await work;
  expect(first).toBe('heartbeat');
  expect(result.extraction.components.map(({ name }) => name)).toEqual(['Surface']);
  expect(result.extraction.sourceInventory?.selectedSourcePaths).toEqual([join(root, 'Surface.tsx')]);
});

it('cancels active compiler work without waiting for it to complete', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    await expect(extractComponentsWithCache(request(controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    clearTimeout(timer);
  }
});

it('rejects an already cancelled extraction before doing source work', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(extractComponentsWithCache(request(controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
});

it('preserves component shapes, source facts, compiler snapshots and exclusions across the worker boundary', async () => {
  const input = request();
  const direct = await extractComponents({
    filePaths: input.sourceFiles,
    projectRoot: input.projectPath,
    opts: { resolveUnreachable: input.resolveUnreachable, evidenceFilePaths: input.evidenceFilePaths },
  });
  const { extraction } = await extractComponentsWithCache(input);
  expect(extraction.components).toEqual(direct.components);
  expect(extraction.compilerSources).toEqual(direct.compilerSources);
  expect(extraction.exclusions).toEqual(direct.exclusions);
  expect(extraction.warnings).toEqual(direct.warnings);
});

it('preserves invalid-source failures across the worker boundary', async () => {
  await expect(extractComponentsWithCache({ ...request(), sourceFiles: [' '] })).rejects.toThrow(
    'filePaths to contain non-empty strings',
  );
});
