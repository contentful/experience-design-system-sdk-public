import { mkdtempSync, realpathSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { createCompilerContexts } from '../../src/extract/compiler/context.js';

const temporaryDirectories: string[] = [];

function temporaryRoot(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'compiler-context-')));
  temporaryDirectories.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string): string {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('compiler contexts', () => {
  it('uses parsed project options, forces noEmit and keeps support files outside output eligibility', () => {
    const root = temporaryRoot();
    const config = write(
      root,
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          allowJs: true,
          baseUrl: '.',
          paths: { '@ui/*': ['src/*'] },
        },
      }),
    );
    const component = write(root, 'src/Button.tsx', 'export const Button = () => <button />;');
    const declaration = write(root, 'types/custom.d.ts', 'declare module "custom";');

    const result = createCompilerContexts([component, declaration], /\.tsx$/, { projectRoot: root });
    const context = result.contexts[0]!;

    expect(context.configPath).toBe(config);
    expect(context.project.getCompilerOptions()).toMatchObject({
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      baseUrl: root,
      paths: { '@ui/*': ['src/*'] },
      noEmit: true,
    });
    expect(context.componentFiles).toEqual([component]);
    expect(context.project.getSourceFile(declaration)).toBeDefined();
    expect(result.diagnostics.projects[0]?.diagnostics).toContain(
      'config-file-discovery-limited-to-explicit-input-roots',
    );
    expect(result.diagnostics.used.directoryEntries).toBeLessThanOrEqual(
      result.diagnostics.limits.maxDirectoryEntries ?? 0,
    );
    expect(result.diagnostics.coverage).toBe('partial');
  });

  it('keeps separate configured contexts for supplied roots and preserves valid module-resolution pairs', () => {
    const root = temporaryRoot();
    const bundlerConfig = write(
      root,
      'apps/web/tsconfig.json',
      JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', strict: false } }),
    );
    const nodeConfig = write(
      root,
      'packages/node/tsconfig.json',
      JSON.stringify({ compilerOptions: { module: 'Node16', moduleResolution: 'Node16', strict: true } }),
    );
    const web = write(root, 'apps/web/src/Web.tsx', 'export const Web = () => null;');
    const node = write(root, 'packages/node/src/Node.tsx', 'export const Node = () => null;');

    const result = createCompilerContexts([web, node], /\.tsx$/, { projectRoot: root });

    expect(result.contexts.map((context) => context.configPath)).toEqual([bundlerConfig, nodeConfig]);
    expect(result.contexts.map((context) => context.project.getCompilerOptions().moduleResolution)).toEqual([
      ts.ModuleResolutionKind.Bundler,
      ts.ModuleResolutionKind.Node16,
    ]);
    expect(result.diagnostics.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ root: web, configPath: bundlerConfig, outcome: 'selected' }),
        expect.objectContaining({ root: node, configPath: nodeConfig, outcome: 'selected' }),
      ]),
    );
  });

  it('records missing or invalid configuration instead of presenting fallback as configured coverage', () => {
    const root = temporaryRoot();
    const component = write(root, 'src/Plain.tsx', 'export const Plain = () => null;');

    const result = createCompilerContexts([component], /\.tsx$/, { projectRoot: root });

    expect(result.diagnostics.projects).toEqual([
      expect.objectContaining({
        root: component,
        configPath: null,
        status: 'fallback',
        diagnostics: ['config-not-found'],
      }),
    ]);
    expect(result.diagnostics.references).toEqual([
      expect.objectContaining({ root: component, configPath: null, outcome: 'fallback' }),
    ]);
    expect(result.diagnostics.coverage).toBe('partial');
    expect(result.contexts[0]?.project.getCompilerOptions().noEmit).toBe(true);
  });
});
