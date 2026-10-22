import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Project, Type } from 'ts-morph';
import { captureNativeSource } from '../../../../../src/steps/extraction/src/candidates/native-source.js';
import {
  createObservedCompilerFileSystem,
  COMPILER_READ_LIMITS,
} from '../../../../../src/steps/extraction/src/compiler/observed-file-system.js';
import {
  compilerSourcesFromContexts,
  createCompilerContexts,
} from '../../../../../src/steps/extraction/src/compiler/context.js';
import { extractEndpoint } from '../../../../../src/steps/extraction/index.js';

const roots: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'compiler-completion-')));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('actual compiler controls', () => {
  it('keeps configured missing and virtual roots under a canonical symlink parent', () => {
    const root = fixture({ 'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler"}}' });
    const aliases = fixture({});
    const alias = join(aliases, 'project');
    symlinkSync(root, alias, 'dir');
    const missing = createCompilerContexts([join(alias, 'missing.tsx')], /\.tsx$/, { projectRoot: alias });
    expect(missing.diagnostics.projects[0]).toMatchObject({
      root: join(realpathSync.native(root), 'missing.tsx'),
      configPath: join(realpathSync.native(root), 'tsconfig.json'),
      status: 'configured',
    });
    expect(missing.diagnostics.projects[0]?.diagnostics).toContain('project-source-unavailable:missing.tsx');
    const virtualPath = join(alias, 'Example.vue.source-evidence.ts');
    const virtual = createCompilerContexts([virtualPath], /\.ts$/, { projectRoot: alias }, [
      { path: virtualPath, content: 'export const value = 1;' },
    ]);
    expect(
      virtual.contexts[0]?.project
        .getSourceFile(join(realpathSync.native(root), 'Example.vue.source-evidence.ts'))
        ?.getFullText(),
    ).toBe('export const value = 1;');
    expect(virtual.diagnostics.reads).toContainEqual(
      expect.objectContaining({
        path: join(realpathSync.native(root), 'Example.vue.source-evidence.ts'),
        kind: 'virtual',
        outcome: 'read',
      }),
    );
  });
  it('retains bounded uncertainty when a loaded compiler program is unavailable', () => {
    const root = fixture({
      'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler"}}',
      'Props.d.ts': 'export interface Props { label: string }' + ' '.repeat(COMPILER_READ_LIMITS.maxCompilerFileBytes),
      'Example.tsx':
        'import type { Props } from "./Props"; export const Example = (props: Props) => <section>{props.label}</section>;',
    });
    const result = createCompilerContexts([join(root, 'Example.tsx')], /\.tsx$/, { projectRoot: root });
    expect(compilerSourcesFromContexts(result.contexts, result.sourceInventory)).toEqual([]);
    expect(result.sourceInventory.omissions).toContainEqual({
      path: result.contexts[0]!.root,
      reason: 'compiler-loaded-source-program-unavailable',
    });
    expect(result.sourceInventory.coverage).toBe('partial');
    expect(result.diagnostics.reads).toContainEqual(
      expect.objectContaining({ outcome: 'unavailable', reason: 'compiler-byte-budget-exhausted' }),
    );
  });
  it('records unavailable assigned source in the saved per-root diagnostic', () => {
    const root = fixture({ 'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler"}}' });
    const result = createCompilerContexts([join(root, 'missing.tsx')], /\.tsx$/, { projectRoot: root });
    expect(result.diagnostics.projects[0]?.diagnostics).toContain('project-source-unavailable:missing.tsx');
  });
  it('reports invalid compiler mode combinations on the actual public endpoint', async () => {
    const root = fixture({
      'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"NodeNext"}}',
      'Example.tsx': 'export const Example = () => <section/>;',
    });
    const result = await extractEndpoint({ filePaths: [join(root, 'Example.tsx')], projectRoot: root });
    expect(result.extractionDiagnostics?.projects[0]?.status).toBe('invalid');
    expect(result.extractionDiagnostics?.projects[0]?.diagnostics.join(' ')).toContain('NodeNext');
  });
  it('hashes actual imported/compiler-library reads instead of a post-hoc file census', () => {
    const declaration = 'export interface Props { label: string; rows: Array<string> }';
    const root = fixture({
      'tsconfig.json': '{"compilerOptions":{"module":"ESNext","moduleResolution":"Bundler","strict":true}}',
      'Props.d.ts': declaration,
      'Example.tsx':
        'import type { Props } from "./Props"; export const Example = (props: Props) => <section>{props.label}</section>;',
    });
    const result = createCompilerContexts([join(root, 'Example.tsx')], /\.tsx$/, { projectRoot: root });
    result.contexts[0]!.project.getSourceFileOrThrow(join(root, 'Example.tsx'))
      .getVariableDeclarationOrThrow('Example')
      .getType();
    const reads = (result.diagnostics as unknown as { reads?: Array<{ path: string; textHash: string; kind: string }> })
      .reads;
    expect(reads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: join(root, 'Props.d.ts'),
          textHash: createHash('sha256').update(declaration).digest('hex'),
        }),
      ]),
    );
    expect(reads?.some((read) => read.path.includes('lib.') && read.kind === 'compiler')).toBe(true);
    expect(result.diagnostics.used.hiddenTypeScriptReads).toBe(0);
  });
  it('forwards public endpoint cancellation before component work', async () => {
    const root = fixture({ 'Example.tsx': 'export const Example = () => <section/>;' });
    const controller = new AbortController();
    controller.abort();
    const result = await extractEndpoint({
      filePaths: [join(root, 'Example.tsx')],
      projectRoot: root,
      signal: controller.signal,
    });
    expect(result.components).toEqual([]);
    expect(result.extractionDiagnostics?.projects[0]?.diagnostics).toContain('compiler-analysis-aborted');
  });
});

it('retains virtual source analysis in the observed compiler host', () => {
  const root = fixture({ 'Example.vue': '<script setup lang="ts">defineProps<{ label: string }>();</script>' });
  const path = join(root, 'Example.vue.source-evidence.ts');
  const result = createCompilerContexts([path], /\.ts$/, { projectRoot: root }, [
    { path, content: 'defineProps<{ label: string }>();' },
  ]);
  expect(result.contexts[0]?.project.getSourceFile(path), JSON.stringify(result.diagnostics.projects)).toBeDefined();
});

it('bounds native property wrapper traversal and measures underlying enumeration separately', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  const source = project.createSourceFile(
    'fields.ts',
    `type Fields = { ${Array.from({ length: 2100 }, (_, i) => `field${i}: string`).join(';')} };`,
  );
  const declaration = source.getTypeAliasOrThrow('Fields');
  const allWrappers = vi.spyOn(Type.prototype, 'getProperties');
  const result = captureNativeSource(declaration.getType(), declaration, true, ['fields']);
  expect(allWrappers).not.toHaveBeenCalled();
  allWrappers.mockRestore();
  expect(result.graph.used?.enumeratedProperties).toBe(2100);
  expect(result.graph.used?.wrappedProperties).toBeLessThan(result.graph.limits.maxNodes);
  expect(result.graph.nodes.length).toBeLessThanOrEqual(result.graph.limits.maxNodes);
  expect(result.graph.coverage).toBe('partial');
  expect(result.graph.omittedCount).toBeGreaterThan(0);
  expect(result.graph.limitations).toContain('compiler-internal-type-resolution-is-not-preemptible');
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});
it('denies oversized support reads before bytes are delivered and records cancellation', () => {
  const root = fixture({ 'oversized.d.ts': ' '.repeat(COMPILER_READ_LIMITS.maxCompilerFileBytes + 1) });
  const controller = new AbortController(),
    reader = createObservedCompilerFileSystem(root, controller.signal);
  expect(() => reader.host.readFileSync(join(root, 'oversized.d.ts'))).toThrow('compiler-byte-budget');
  expect(reader.used.compilerBytes).toBe(0);
  expect(reader.reads).toMatchObject([{ outcome: 'unavailable', reason: 'compiler-byte-budget-exhausted' }]);
  controller.abort();
  expect(() => reader.host.readFileSync(join(root, 'later.d.ts'))).toThrow('compiler-analysis-cancelled');
  expect(reader.used.compilerBytes).toBe(0);
});
