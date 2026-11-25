import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Project } from 'ts-morph';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCompilerContexts,
  compilerSourcesFromContexts,
  createCompilerSourceCollector,
  forEachCompilerContext,
  type CompilerProjectContext,
} from '../../../../../src/steps/extraction/src/compiler/context.js';
import * as observedFileSystem from '../../../../../src/steps/extraction/src/compiler/observed-file-system.js';
import { COMPILER_READ_LIMITS } from '../../../../../src/steps/extraction/src/compiler/observed-file-system.js';

const roots: string[] = [];
const SHAPE_DECLARATIONS = `export interface Shape { label: string }
export interface Shape { count: number }
declare global { interface GlobalValue { enabled: boolean } }`;
const shapeAugmentation = (module: string) =>
  `import '${module}';
declare module '${module}' { interface Shape { mode: 'compact' | 'wide' } }`;

function trackCreatedPrograms(afterCreate?: () => void): Set<Project> {
  const programs = new Set<Project>();
  const original = Project.prototype.getProgram;
  vi.spyOn(Project.prototype, 'getProgram').mockImplementation(function (this: Project) {
    programs.add(this);
    const program = original.call(this);
    afterCreate?.();
    return program;
  });
  return programs;
}
function fixture(): { root: string; files: string[] } {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'compiler-lifetime-')));
  roots.push(root);
  const files: string[] = [];
  for (const name of ['alpha', 'beta']) {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noLib: true,
        },
      }),
    );
    const file = join(directory, 'View.tsx');
    writeFileSync(file, 'export function View(props: { label: string }) { return props.label; }');
    files.push(file);
  }
  return { root, files };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('configured compiler lifetimes', () => {
  it('reuses the sole complete preflight program without a transcript or reconstruction and preserves eager evidence', () => {
    const { files } = fixture();
    const root = dirname(files[0]!);
    const file = files[0]!;
    writeFileSync(join(root, 'Shape.ts'), SHAPE_DECLARATIONS);
    writeFileSync(join(root, 'augment.ts'), shapeAugmentation('./Shape'));
    writeFileSync(
      file,
      `import type { Shape } from './Shape';
import './augment';
export function View(props: Shape & GlobalValue) { return props.label; }`,
    );
    const virtualPath = join(root, 'Virtual.tsx');
    const virtualSources = [
      { path: virtualPath, content: 'export function View(props: { virtual: boolean }) { return props.virtual; }' },
    ];
    const selected = [file, virtualPath];
    const consume = (context: CompilerProjectContext) => {
      const declarations = context.componentFiles.map((path) => {
        const parameter = context.project.getSourceFileOrThrow(path).getFunctionOrThrow('View').getParameters()[0]!;
        return parameter
          .getType()
          .getProperties()
          .map((property) => ({
            name: property.getName(),
            type: property.getTypeAtLocation(parameter).getText(parameter),
          }));
      });
      try {
        context.project.addSourceFileAtPath(join(root, 'missing-template.ts'));
      } catch {}
      return declarations;
    };
    const eager = createCompilerContexts(selected, /\.tsx$/, { projectRoot: root }, virtualSources);
    const expected = eager.contexts.flatMap(consume);
    const expectedSources = compilerSourcesFromContexts(eager.contexts, eager.sourceInventory);
    const programs = trackCreatedPrograms();
    const originalHost = observedFileSystem.createObservedCompilerFileSystem;
    const hosts: ReturnType<typeof originalHost>[] = [];
    vi.spyOn(observedFileSystem, 'createObservedCompilerFileSystem').mockImplementation((...args) => {
      const host = originalHost(...args);
      vi.spyOn(host, 'captureSnapshot');
      vi.spyOn(host, 'replaySnapshot');
      hosts.push(host);
      return host;
    });
    const actual: ReturnType<typeof consume> = [];
    let collector: ReturnType<typeof createCompilerSourceCollector> | undefined;
    const sequential = forEachCompilerContext(
      selected,
      /\.tsx$/,
      { projectRoot: root },
      (context, _diagnostics, inventory) => {
        actual.push(...consume(context));
        collector ??= createCompilerSourceCollector(inventory);
        collector.add(context);
      },
      virtualSources,
    );
    expect(programs.size).toBe(1);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.captureSnapshot).not.toHaveBeenCalled();
    expect(hosts[0]!.replaySnapshot).not.toHaveBeenCalled();
    expect(actual).toEqual(expected);
    expect(actual[0]!.map((property) => property.name)).toEqual(['label', 'count', 'mode', 'enabled']);
    expect(collector!.sources()).toEqual(expectedSources);
    expect(sequential.diagnostics).toEqual(eager.diagnostics);
    expect(sequential.sourceInventory.files).toEqual(eager.sourceInventory.files);
  });

  it('keeps snapshot preflight when support roots select another referenced configuration', () => {
    const { root, files } = fixture();
    for (const file of files) rmSync(join(dirname(file), 'tsconfig.json'));
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ files: [], references: [{ path: './app.json' }, { path: './support.json' }] }),
    );
    const compilerOptions = { module: 'ESNext', moduleResolution: 'Bundler', noLib: true };
    writeFileSync(join(root, 'app.json'), JSON.stringify({ compilerOptions, include: ['alpha'] }));
    writeFileSync(join(root, 'support.json'), JSON.stringify({ compilerOptions, include: ['beta'] }));
    const eager = createCompilerContexts([files[0]!], /\.tsx$/, { projectRoot: root });
    expect(eager.contexts.map((context) => context.configPath)).toEqual([
      join(root, 'app.json'),
      join(root, 'support.json'),
    ]);
    const programs = trackCreatedPrograms();
    const consumed: number[] = [];
    const sequential = forEachCompilerContext([files[0]!], /\.tsx$/, { projectRoot: root }, () =>
      consumed.push(programs.size),
    );
    expect(consumed).toEqual([3, 4]);
    expect(sequential.diagnostics).toEqual(eager.diagnostics);
    expect(sequential.sourceInventory.files).toEqual(eager.sourceInventory.files);
  });

  it.each(['before-creation', 'after-creation'] as const)(
    'does not consume the sole program after cancellation %s',
    (phase) => {
      const { files } = fixture();
      const root = dirname(files[0]!);
      const controller = new AbortController();
      const programs = trackCreatedPrograms(() => {
        if (phase === 'after-creation') controller.abort();
      });
      if (phase === 'before-creation') controller.abort();
      const consume = vi.fn();
      const result = forEachCompilerContext(
        [files[0]!],
        /\.tsx$/,
        { projectRoot: root, signal: controller.signal },
        consume,
      );
      expect(consume).not.toHaveBeenCalled();
      expect(programs.size).toBe(phase === 'before-creation' ? 0 : 1);
      expect(result.diagnostics.projects).toContainEqual(
        expect.objectContaining({
          status: 'invalid',
          diagnostics: expect.arrayContaining(['compiler-analysis-aborted']),
        }),
      );
      if (phase === 'after-creation')
        expect(result.diagnostics.modules).toContainEqual(
          expect.objectContaining({ reason: 'compiler-analysis-cancelled' }),
        );
    },
  );

  it('propagates sole-program consumer failure without creating a replacement', () => {
    const { files } = fixture();
    const programs = trackCreatedPrograms();
    expect(() =>
      forEachCompilerContext([files[0]!], /\.tsx$/, { projectRoot: dirname(files[0]!) }, () => {
        throw new Error('capture-consumer-failed');
      }),
    ).toThrow('capture-consumer-failed');
    expect(programs.size).toBe(1);
  });

  it('preserves imported, global, merged, augmented and inferred types plus exact captured source hashes', () => {
    const { root, files } = fixture();
    const write = (name: string, content: string): string => {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return path;
    };
    write(
      'shared/tsconfig.json',
      JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', noLib: true, strict: true } }),
    );
    write(
      'shared/types.ts',
      `${SHAPE_DECLARATIONS}
export const makeValue = () => ({ label: 'value', count: 2 });`,
    );
    write('shared/augment.ts', shapeAugmentation('./types'));
    for (const file of files)
      writeFileSync(
        file,
        `import { makeValue, type Shape } from '../shared/types';
import '../shared/augment';
export const inferred = makeValue();
export function View(props: Shape & GlobalValue) { return props.label; }`,
      );
    const projection = (context: CompilerProjectContext) => ({
      configPath: context.configPath,
      assignedFiles: context.assignedFiles,
      componentFiles: context.componentFiles,
      declarations: context.componentFiles.map((path) => {
        const source = context.project.getSourceFileOrThrow(path);
        const parameter = source.getFunctionOrThrow('View').getParameters()[0]!;
        return {
          path,
          properties: parameter
            .getType()
            .getProperties()
            .map((property) => ({
              name: property.getName(),
              type: property.getTypeAtLocation(parameter).getText(parameter),
            })),
          inferred: source.getVariableDeclarationOrThrow('inferred').getType().getText(),
        };
      }),
    });
    const eager = createCompilerContexts(files, /\.tsx$/, { projectRoot: root });
    const expected = eager.contexts.map(projection);
    const expectedSources = compilerSourcesFromContexts(eager.contexts, eager.sourceInventory);
    const actual: ReturnType<typeof projection>[] = [];
    let collector: ReturnType<typeof createCompilerSourceCollector> | undefined;
    const sequential = forEachCompilerContext(
      files,
      /\.tsx$/,
      { projectRoot: root },
      (context, _diagnostics, inventory) => {
        actual.push(projection(context));
        collector ??= createCompilerSourceCollector(inventory);
        collector.add(context);
      },
    );
    expect(actual).toEqual(expected);
    expect(
      actual
        .flatMap((context) => context.declarations)
        .map((declaration) => declaration.properties.map((property) => property.name)),
    ).toEqual([
      ['label', 'count', 'mode', 'enabled'],
      ['label', 'count', 'mode', 'enabled'],
    ]);
    expect(collector!.sources()).toEqual(expectedSources);
    for (const source of collector!.sources())
      expect(source.textHash).toBe(createHash('sha256').update(source.content).digest('hex'));
    expect(sequential.diagnostics).toEqual(eager.diagnostics);
    expect(sequential.sourceInventory.files).toEqual(eager.sourceInventory.files);
  });

  it('propagates consumer failure without reconstructing later programs', () => {
    const { root, files } = fixture();
    const programs = trackCreatedPrograms();
    expect(() =>
      forEachCompilerContext(files, /\.tsx$/, { projectRoot: root }, () => {
        throw new Error('capture-consumer-failed');
      }),
    ).toThrow('capture-consumer-failed');
    expect(programs.size).toBe(3);
  });

  it('preserves exact compiler/config/consumer read receipt order', () => {
    const { root, files } = fixture();
    const readMissingTemplate = (context: CompilerProjectContext) => {
      try {
        context.project.addSourceFileAtPath(join(dirname(context.root), 'View.template.ts'));
      } catch {}
    };
    const eager = createCompilerContexts(files, /\.tsx$/, { projectRoot: root });
    for (const context of eager.contexts) readMissingTemplate(context);
    const sequential = forEachCompilerContext(files, /\.tsx$/, { projectRoot: root }, readMissingTemplate);
    expect(sequential.diagnostics).toEqual(eager.diagnostics);
  });

  it.each([5, 6])('preserves source priority and bounded read receipts at read limit %i', (limit) => {
    const { root, files } = fixture();
    const previousLimit = COMPILER_READ_LIMITS.maxCompilerReads;
    COMPILER_READ_LIMITS.maxCompilerReads = limit;
    const consume = (context: CompilerProjectContext) => {
      const admitted = context.componentFiles.filter((path) => context.project.getSourceFile(path));
      for (let index = 0; index < 4; index++) {
        try {
          context.project.addSourceFileAtPath(join(dirname(context.root), `missing-${index}.ts`));
        } catch {}
      }
      return admitted;
    };
    try {
      const eager = createCompilerContexts(files, /\.tsx$/, { projectRoot: root });
      const expected = eager.contexts.flatMap(consume);
      const admitted: string[] = [];
      const sequential = forEachCompilerContext(files, /\.tsx$/, { projectRoot: root }, (context) =>
        admitted.push(...consume(context)),
      );
      expect(admitted).toEqual(expected);
      expect(sequential.diagnostics).toEqual(eager.diagnostics);
    } finally {
      COMPILER_READ_LIMITS.maxCompilerReads = previousLimit;
    }
  });
});
