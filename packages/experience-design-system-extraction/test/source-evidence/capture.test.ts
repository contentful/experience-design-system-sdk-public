import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { captureSourceEvidence } from '../../src/source-evidence/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixtureRoot(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'source-evidence-'));
  tempDirs.push(tempDir);
  const root = join(await realpath(tempDir), 'project');
  await mkdir(root);
  return root;
}

async function write(root: string, path: string, content: string): Promise<string> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
  return absolute;
}

describe('captureSourceEvidence', () => {
  it('captures deduplicated source and resolves aliases, extension rewrites, roles, hashes, and cycles', async () => {
    const root = await fixtureRoot();
    await write(
      root,
      'tsconfig.base.json',
      JSON.stringify({
        compilerOptions: {
          module: 'Preserve',
          moduleResolution: 'Bundler',
          baseUrl: '.',
          paths: { '@shared/*': ['src/shared/*'] },
        },
      }),
    );
    await write(root, 'tsconfig.json', JSON.stringify({ extends: './tsconfig.base.json' }));
    const componentPath = await write(
      root,
      'src/Button.ts',
      [
        "import { theme } from '@shared/theme.js';",
        "import { Alias } from './types.js';",
        "import './cycle-a.js';",
        "import 'react';",
        'export const Button = (props: Alias) => theme + props.label;',
      ].join('\n'),
    );
    const themePath = await write(root, 'src/shared/theme.ts', 'export const theme = "blue";\n');
    const typesPath = await write(root, 'src/types.ts', 'export type Alias = { label: string };\n');
    await write(root, 'src/cycle-a.ts', "import './cycle-b.js';\n");
    await write(root, 'src/cycle-b.ts', "import './cycle-a.js';\n");

    const capture = await captureSourceEvidence({
      projectRoot: root,
      filePaths: [componentPath, componentPath],
      components: [{ componentId: 'button-id', name: 'Button', sourcePath: componentPath }],
    });

    expect(capture.coverage).toBe('partial');
    expect(capture.extractionByteBinding).toBe('unverified');
    expect(
      capture.files.filter((file) => file.captured.kind === 'full').map((file) => relative(root, file.canonicalPath)),
    ).toEqual([
      'src/Button.ts',
      'src/cycle-a.ts',
      'src/cycle-b.ts',
      'src/shared/theme.ts',
      'src/types.ts',
      'tsconfig.base.json',
      'tsconfig.json',
    ]);
    expect(capture.files.filter((file) => file.canonicalPath === resolve(componentPath))).toHaveLength(1);
    const componentFile = capture.files.find((file) => file.canonicalPath === resolve(componentPath))!;
    expect(componentFile.componentRefs).toEqual([{ componentId: 'button-id', name: 'Button', roles: ['definition'] }]);
    expect(componentFile.roles).toContain('definition');
    expect(componentFile.textHash).toMatch(/^[a-f0-9]{64}$/);
    expect(capture.resolution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specifier: '@shared/theme.js',
          outcome: 'resolved',
          targetFileId: expect.any(String),
        }),
        expect.objectContaining({ specifier: './types.js', outcome: 'resolved', targetFileId: expect.any(String) }),
        expect.objectContaining({ specifier: 'react', outcome: 'external' }),
        expect.objectContaining({ specifier: './cycle-a.js', outcome: 'cycle' }),
      ]),
    );
    expect(capture.files.find((file) => file.canonicalPath === resolve(themePath))?.roles).toContain('import');
    expect(capture.files.find((file) => file.canonicalPath === resolve(typesPath))?.roles).toContain('import');
    expect(capture.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('records escapes, unreadable imports, and file/depth limits as partial evidence', async () => {
    const root = await fixtureRoot();
    const componentPath = await write(
      root,
      'src/Button.ts',
      "import '../../outside.js';\nimport './missing.js';\nimport './present.js';\n",
    );
    await write(root, 'src/present.ts', 'export const present = true;\n');
    await write(root, '../outside.ts', 'export const outside = true;\n');

    const capture = await captureSourceEvidence({
      projectRoot: root,
      filePaths: [componentPath],
      components: [{ componentId: 'button-id', name: 'Button', sourcePath: componentPath }],
      limits: { maxFiles: 1 },
    });

    expect(capture.coverage).toBe('partial');
    expect(capture.resolution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ specifier: '../../outside.js', outcome: 'excluded' }),
        expect.objectContaining({ specifier: './missing.js', outcome: 'unresolved' }),
      ]),
    );
    expect(capture.diagnostics.some((diagnostic) => diagnostic.kind === 'budget')).toBe(true);
    expect(capture.bounds.used.files).toBeLessThanOrEqual(1);
  });

  it('does not follow a legacy or absent source path and records explicit unavailable coverage', async () => {
    const root = await fixtureRoot();
    const missing = join(root, 'src/Missing.ts');
    const capture = await captureSourceEvidence({
      projectRoot: root,
      filePaths: [missing],
      components: [{ componentId: 'missing-id', name: 'Missing', sourcePath: missing }],
    });

    expect(capture.coverage).toBe('unavailable');
    expect(capture.files).toEqual([
      expect.objectContaining({
        captured: { kind: 'unavailable', reason: 'unreadable' },
        roles: expect.arrayContaining(['definition']),
      }),
    ]);
  });
});
