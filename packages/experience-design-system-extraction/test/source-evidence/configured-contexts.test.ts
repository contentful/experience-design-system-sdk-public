import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { captureSourceEvidence } from '../../src/index.js';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function project(root: string, directory: string) {
  const local = join(root, directory);
  mkdirSync(join(local, 'parts'), { recursive: true });
  const source = join(local, 'parts', 'widget.tsx');
  const app = join(local, 'app.tsx');
  writeFileSync(
    join(local, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@parts/*': ['parts/*'] }, noEmit: false } }),
  );
  writeFileSync(source, 'export function Widget() { return <section/>; }');
  writeFileSync(
    app,
    'import { Widget as LocalWidget } from "@parts/widget"; export const View = () => <LocalWidget/>; export const call = () => LocalWidget();',
  );
  return { local, source, app };
}
it('keeps matched nested configuration resolution and caller roles under either admitted root', async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'configured-source-')));
  roots.push(root);
  const { local, source, app } = project(root, 'packages/example-app');
  const input = {
    filePaths: [source, app],
    components: [{ componentId: 'widget', name: 'Widget', sourcePath: source }],
  };
  const wide = await captureSourceEvidence({ ...input, projectRoot: root });
  const narrow = await captureSourceEvidence({ ...input, projectRoot: local });
  for (const capture of [wide, narrow]) {
    expect(capture.resolution.find((edge) => edge.specifier === '@parts/widget')?.outcome).toBe('resolved');
    expect(capture.files.find((file) => file.canonicalPath === app)?.componentRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentId: 'widget',
          roles: expect.arrayContaining(['binding', 'application', 'caller', 'reference']),
        }),
      ]),
    );
  }
});
it('binds the same configured alias and exported label to distinct project declarations', async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'configured-conflicts-')));
  roots.push(root);
  const a = project(root, 'packages/first');
  const b = project(root, 'packages/second');
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [a.app, a.source, b.app, b.source],
    components: [
      { componentId: 'first-widget', name: 'Widget', sourcePath: a.source },
      { componentId: 'second-widget', name: 'Widget', sourcePath: b.source },
    ],
  });
  for (const [entry, id] of [
    [a, 'first-widget'],
    [b, 'second-widget'],
  ] as const) {
    const file = capture.files.find((file) => file.canonicalPath === entry.app)!;
    expect(file.componentRefs.map((reference) => reference.componentId)).toEqual([id]);
    expect(file.componentRefs[0]!.roles).toEqual(expect.arrayContaining(['application', 'caller', 'reference']));
    const target = capture.resolution.find(
      (edge) => edge.fromFileId === file.fileId && edge.specifier === '@parts/widget',
    )!.targetFileId;
    expect(capture.files.find((file) => file.fileId === target)!.canonicalPath).toBe(entry.source);
  }
});

function temporaryRoot() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'configured-controls-')));
  roots.push(root);
  return root;
}
function configured(capture: Awaited<ReturnType<typeof captureSourceEvidence>>, path: string) {
  const file = capture.files.find((file) => file.canonicalPath === path)!;
  return capture.compilerContexts!.find((context) => context.contextId === file.compilerContextId)!;
}
it('records deduplicated nearest JSONC and relative array bases with effective noEmit and canonical hashes', async () => {
  const root = temporaryRoot();
  const entry = project(root, 'packages/example');
  mkdirSync(join(root, 'config'));
  writeFileSync(
    join(root, 'config/base.json'),
    '{ // admitted relative base\n"compilerOptions":{"baseUrl":"../packages/example","paths":{"@parts/*":["parts/*"]}}}',
  );
  writeFileSync(join(root, 'config/strict.json'), '{"compilerOptions":{"strict":true}}');
  writeFileSync(
    join(entry.local, 'tsconfig.json'),
    '{"extends":["../../config/base.json","../../config/strict.json"],"compilerOptions":{"noEmit":false}}',
  );
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [entry.app, entry.source],
    components: [{ componentId: 'widget', name: 'Widget', sourcePath: entry.source }],
  });
  const context = configured(capture, entry.app);
  expect(context).toMatchObject({
    status: 'configured',
    referenceOutcome: 'selected',
    compilerOptions: { strict: true, noEmit: true, paths: { '@parts/*': ['parts/*'] } },
  });
  expect(context.contextId).toBe(configured(capture, entry.source).contextId);
  expect(context.configFiles).toHaveLength(3);
  for (const config of context.configFiles)
    expect(capture.files.find((file) => file.fileId === config.fileId)).toMatchObject({
      textHash: config.textHash,
      captured: { kind: 'full' },
      roles: ['config', 'evidence'],
    });
  expect(capture.resolution.find((edge) => edge.specifier === '@parts/widget')?.outcome).toBe('resolved');
  expect(capture.files.filter((file) => file.roles.includes('config'))).toHaveLength(3);
});
it('uses nearest jsconfig and retains deterministic same-directory tsconfig preference as ambiguous', async () => {
  const root = temporaryRoot();
  const entry = project(root, 'packages/example');
  rmSync(join(entry.local, 'tsconfig.json'));
  writeFileSync(
    join(entry.local, 'jsconfig.json'),
    '{"compilerOptions":{"baseUrl":".","paths":{"@parts/*":["parts/*"]}}}',
  );
  const js = await captureSourceEvidence({ projectRoot: root, filePaths: [entry.app] });
  expect(configured(js, entry.app)).toMatchObject({
    status: 'configured',
    configPath: join(entry.local, 'jsconfig.json'),
  });
  writeFileSync(join(entry.local, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
  const both = await captureSourceEvidence({ projectRoot: root, filePaths: [entry.app] });
  expect(configured(both, entry.app)).toMatchObject({
    status: 'ambiguous',
    configPath: join(entry.local, 'tsconfig.json'),
    diagnostics: expect.arrayContaining(['multiple-config-files-at-same-root']),
  });
  expect(both.coverage).toBe('partial');
});
it.each([
  ['fallback', undefined, 'config-not-found'],
  ['invalid', '{ broken', ''],
  ['missing-base', '{"extends":"./missing.json"}', ''],
  ['cyclic-base', '{"extends":"./tsconfig.json"}', ''],
  ['package-base', '{"extends":"example-config/base"}', 'unsupported-package-config-extends:'],
] as const)('retains explicit %s context uncertainty without discovering components', async (_label, text, reason) => {
  const root = temporaryRoot();
  const entry = project(root, 'packages/example');
  if (text === undefined) rmSync(join(entry.local, 'tsconfig.json'));
  else writeFileSync(join(entry.local, 'tsconfig.json'), text);
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [entry.source],
    components: [{ componentId: 'widget', name: 'Widget', sourcePath: entry.source }],
  });
  const context = configured(capture, entry.source);
  expect(context.status).toBe(text === undefined ? 'fallback' : 'invalid');
  expect(context.diagnostics.length).toBeGreaterThan(0);
  expect(context.diagnostics.some((message) => message.startsWith(reason))).toBe(true);
  expect(context.compilerOptions.noEmit).toBe(true);
  if (text !== undefined) expect(capture.coverage).toBe('partial');
  expect(capture.files.flatMap((file) => file.componentRefs).every((ref) => ref.componentId === 'widget')).toBe(true);
});
it('rejects an escaped nearest config and nested package bases without reading dependencies', async () => {
  const root = temporaryRoot(),
    outside = temporaryRoot();
  const entry = project(root, 'packages/example');
  const foreign = join(outside, 'foreign.json');
  writeFileSync(foreign, '{"compilerOptions":{"strict":true}}');
  rmSync(join(entry.local, 'tsconfig.json'));
  symlinkSync(foreign, join(entry.local, 'tsconfig.json'));
  const escaped = await captureSourceEvidence({ projectRoot: root, filePaths: [entry.source] });
  expect(configured(escaped, entry.source)).toMatchObject({
    status: 'invalid',
    diagnostics: expect.arrayContaining(['config-outside-admitted-source']),
  });
  expect(escaped.files.some((file) => file.canonicalPath === foreign)).toBe(false);
  rmSync(join(entry.local, 'tsconfig.json'));
  writeFileSync(join(entry.local, 'tsconfig.json'), '{"extends":"./base.json"}');
  writeFileSync(join(entry.local, 'base.json'), '{"extends":"example-config/base"}');
  const nested = await captureSourceEvidence({ projectRoot: root, filePaths: [entry.source] });
  expect(configured(nested, entry.source).diagnostics).toContain(
    'unsupported-package-config-extends:example-config/base',
  );
  expect(nested.files.some((file) => file.canonicalPath.includes('node_modules'))).toBe(false);
});
it('selects admitted reference configs and preserves cycle, missing and reference-budget diagnostics', async () => {
  const root = temporaryRoot();
  const entry = project(root, 'packages/example');
  rmSync(join(entry.local, 'tsconfig.json'));
  writeFileSync(join(root, 'tsconfig.json'), '{"references":[{"path":"./packages/example/project.json"}]}');
  writeFileSync(
    join(entry.local, 'project.json'),
    '{"compilerOptions":{"baseUrl":".","paths":{"@parts/*":["parts/*"]}}}',
  );
  const selected = await captureSourceEvidence({ projectRoot: root, filePaths: [entry.app] });
  expect(configured(selected, entry.app)).toMatchObject({
    status: 'configured',
    referenceOutcome: 'selected',
    configPath: join(entry.local, 'project.json'),
  });
  expect(selected.resolution.find((edge) => edge.specifier === '@parts/widget')?.outcome).toBe('resolved');
  writeFileSync(join(entry.local, 'project.json'), '{"references":[{"path":"../../tsconfig.json"}]}');
  const cycle = await captureSourceEvidence({ projectRoot: root, filePaths: [entry.app] });
  expect(configured(cycle, entry.app).referenceOutcome).toBe('cycle');
  expect(cycle.coverage).toBe('partial');
  rmSync(join(entry.local, 'project.json'));
  const missing = await captureSourceEvidence({ projectRoot: root, filePaths: [entry.app] });
  expect(configured(missing, entry.app).status).toBe('invalid');
  const bounded = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [entry.app],
    limits: { maxResolverProbes: 7 },
  });
  expect(bounded.bounds.used.resolverProbes).toBeLessThanOrEqual(7);
  expect(bounded.coverage).toBe('partial');
});
it('shares total file/read/content/resolver/reference budgets across distinct contexts', async () => {
  const root = temporaryRoot();
  const a = project(root, 'packages/first'),
    b = project(root, 'packages/second');
  const input = {
    projectRoot: root,
    filePaths: [a.app, a.source, b.app, b.source],
    components: [
      { componentId: 'first', name: 'Widget', sourcePath: a.source },
      { componentId: 'second', name: 'Widget', sourcePath: b.source },
    ],
  };
  const reference = await captureSourceEvidence({ ...input, limits: { maxReferenceNodes: 25 } });
  expect(reference.compilerContexts).toHaveLength(2);
  expect(reference.bounds.used.referenceNodes).toBe(25);
  expect(reference.coverage).toBe('partial');
  for (const limits of [{ maxFiles: 3 }, { maxReadAttempts: 2 }, { maxTotalBytes: 220 }, { maxResolverProbes: 6 }]) {
    const capture = await captureSourceEvidence({ ...input, limits });
    expect(capture.bounds.used.files).toBeLessThanOrEqual(limits.maxFiles ?? 256);
    expect(capture.bounds.used.readAttempts).toBeLessThanOrEqual(limits.maxReadAttempts ?? 1024);
    expect(capture.bounds.used.totalBytes).toBeLessThanOrEqual(limits.maxTotalBytes ?? 8 * 1024 * 1024);
    expect(capture.bounds.used.resolverProbes).toBeLessThanOrEqual(limits.maxResolverProbes ?? 4096);
    expect(capture.coverage).toBe('partial');
    expect(capture.diagnostics.some((item) => item.kind === 'budget')).toBe(true);
  }
});
it('records unreadable config bytes and honors elapsed-time and cancellation limits', async () => {
  const root = temporaryRoot();
  const entry = project(root, 'packages/example');
  const limited = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [entry.source],
    limits: { maxFileBytes: 65 },
  });
  expect(configured(limited, entry.source).diagnostics.some((reason) => reason.includes('max-file-bytes'))).toBe(true);
  const controller = new AbortController();
  controller.abort();
  await expect(
    captureSourceEvidence({ projectRoot: root, filePaths: [entry.source], signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  let tick = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => ++tick * 100);
  try {
    const timed = await captureSourceEvidence({
      projectRoot: root,
      filePaths: [entry.source],
      limits: { maxCaptureMs: 1 },
    });
    expect(timed.diagnostics).toContainEqual({ kind: 'budget', reason: 'max-capture-ms' });
  } finally {
    clock.mockRestore();
  }
});
