import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCompilerContexts } from '../../../../../src/steps/extraction/src/compiler/context.js';

const roots: string[] = [];
function fixture(files: Record<string, unknown>) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'referenced-projects-')));
  roots.push(root);
  for (const [name, value] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
const options = { module: 'ESNext', moduleResolution: 'Bundler', strict: true, paths: { '@ui/*': ['./src/*'] } };
const solution = {
  files: [],
  references: [{ path: './app.json' }, { path: './tools.json' }, { path: './stories.json' }],
};

describe('referenced compiler project membership', () => {
  it('uses include, exclude and files when referenced configs share one directory', () => {
    const root = fixture({
      'tsconfig.json': solution,
      'app.json': { compilerOptions: options, include: ['src'], exclude: ['**/*.stories.tsx'] },
      'tools.json': { compilerOptions: options, files: ['tool.ts'] },
      'stories.json': { compilerOptions: options, include: ['src/**/*.stories.tsx'] },
      'src/Panel.tsx': 'export function Panel() { return <section />; }',
      'src/Panel.stories.tsx': 'export const example = 1;',
      'tool.ts': 'export const tool = 1;',
    });
    const source = join(root, 'src/Panel.tsx');
    const result = createCompilerContexts([source], /\.tsx$/, { projectRoot: root });
    expect(result.diagnostics.references).toContainEqual(
      expect.objectContaining({ root: source, configPath: join(root, 'app.json'), outcome: 'selected' }),
    );
    expect(
      result.contexts.find((context) => context.assignedFiles.includes(source))?.project.getCompilerOptions().paths,
    ).toEqual(options.paths);
  });

  it('retains ambiguity when overlapping projects change source semantics', () => {
    const root = fixture({
      'tsconfig.json': { files: [], references: [{ path: './strict.json' }, { path: './loose.json' }] },
      'strict.json': { compilerOptions: options, include: ['src'] },
      'loose.json': { compilerOptions: { ...options, strict: false }, include: ['src'] },
      'src/Panel.tsx': 'export function Panel() { return null; }',
    });
    const source = join(root, 'src/Panel.tsx');
    const result = createCompilerContexts([source], /\.tsx$/, { projectRoot: root });
    expect(result.diagnostics.references).toContainEqual(
      expect.objectContaining({ root: source, outcome: 'ambiguous' }),
    );
  });

  it('charges repeated shared project references once rather than exhausting the budget across roots', () => {
    const files: Record<string, unknown> = {
      'tsconfig.json': {
        files: [],
        references: [{ path: './app.json' }, { path: './tools.json' }, { path: './app.json' }],
      },
      'app.json': { compilerOptions: options, include: ['src'] },
      'tools.json': { compilerOptions: options, files: ['tool.ts'] },
      'tool.ts': 'export const tool = 1;',
    };
    for (let i = 0; i < 70; i++) files[`src/File${i}.tsx`] = 'export const value = 1;';
    const root = fixture(files);
    const sources = Array.from({ length: 70 }, (_, i) => join(root, `src/File${i}.tsx`));
    const result = createCompilerContexts(sources, /\.tsx$/, { projectRoot: root });
    expect(
      result.diagnostics.references
        .filter((reference) => sources.includes(reference.root))
        .every((reference) => reference.outcome === 'selected'),
    ).toBe(true);
    expect(result.diagnostics.used.references).toBe(2);
  });

  it('retains cached configuration dependencies when subsequent roots use a different project', () => {
    const root = fixture({
      'tsconfig.json': { files: [], references: [{ path: './app.json' }, { path: './stories.json' }] },
      'base.json': { compilerOptions: options },
      'app.json': { extends: './base.json', include: ['src'], exclude: ['**/*.stories.tsx'] },
      'stories.json': { extends: './base.json', include: ['src/**/*.stories.tsx'] },
      'src/A.tsx': 'export function A() { return null; }',
      'src/Z.stories.tsx': 'export const example = 1;',
    });
    const result = createCompilerContexts([join(root, 'src/A.tsx'), join(root, 'src/Z.stories.tsx')], /\.tsx$/, {
      projectRoot: root,
    });
    expect(result.contexts.find((context) => context.configPath === join(root, 'stories.json'))?.configSources).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: join(root, 'base.json') })]),
    );
  });
});
