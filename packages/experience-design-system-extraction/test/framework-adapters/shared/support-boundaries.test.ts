import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Project } from 'ts-morph';
import { afterEach, describe, expect, it } from 'vitest';
import { runFileExtractionWorkers } from '../../../src/extract/framework-adapters/shared/helpers/file-processing/file-workers.js';
import { extractProjectSourceFiles } from '../../../src/extract/framework-adapters/shared/helpers/file-processing/project-source-files.js';
import { createSortedExtractionResult } from '../../../src/extract/framework-adapters/shared/helpers/file-processing/result-normalizer.js';
import { resolveLocalModule } from '../../../src/extract/framework-adapters/shared/helpers/resolve-import-file-path.js';
import { resolveTypeProperty } from '../../../src/extract/framework-adapters/shared/helpers/resolve-type-symbol.js';
import { getSourceLineMetadata } from '../../../src/extract/framework-adapters/shared/helpers/get-node-source-lines.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('file extraction workers', () => {
  it('captures per-file warnings, reports progress, and invokes result callbacks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'extraction-workers-'));
    tempDirectories.push(directory);
    const firstPath = join(directory, 'first.ts');
    const secondPath = join(directory, 'second.ts');
    await writeFile(firstPath, 'First');
    await writeFile(secondPath, 'Second');

    const progress: Array<{ filesProcessed: number; componentsFound: number }> = [];
    const callbacks: string[] = [];
    const result = await runFileExtractionWorkers(
      [firstPath, secondPath],
      2,
      async (filePath, source) => ({
        item: { name: source },
        warnings: filePath === secondPath ? ['second-file-warning'] : [],
      }),
      (filePath) => `failed: ${filePath}`,
      (update) => progress.push(update),
      (filePath) => callbacks.push(filePath),
    );

    expect(result.items.map((item) => item.name).sort()).toEqual(['First', 'Second']);
    expect(result.warnings).toEqual(['second-file-warning']);
    expect(callbacks.sort()).toEqual([firstPath, secondPath].sort());
    expect(progress.at(-1)).toEqual({ filesProcessed: 2, componentsFound: 2 });
  });

  it('bounds concurrent file extraction workers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'extraction-worker-concurrency-'));
    tempDirectories.push(directory);
    const filePaths = await Promise.all(
      ['one.ts', 'two.ts', 'three.ts', 'four.ts'].map(async (fileName) => {
        const filePath = join(directory, fileName);
        await writeFile(filePath, fileName);
        return filePath;
      }),
    );

    let activeWorkers = 0;
    let maximumActiveWorkers = 0;
    const result = await runFileExtractionWorkers(
      filePaths,
      2,
      async (filePath) => {
        activeWorkers++;
        maximumActiveWorkers = Math.max(maximumActiveWorkers, activeWorkers);
        await delay(2);
        activeWorkers--;
        return { item: { name: basename(filePath) } };
      },
      (filePath) => `failed: ${filePath}`,
    );

    expect(maximumActiveWorkers).toBeLessThanOrEqual(2);
    expect(result.items).toHaveLength(4);
    expect(result.warnings).toEqual([]);
  });

  it('normalizes component results by name without changing warnings', () => {
    expect(createSortedExtractionResult([{ name: 'Zebra' }, { name: 'Alpha' }], ['warning'])).toEqual({
      components: [{ name: 'Alpha' }, { name: 'Zebra' }],
      warnings: ['warning'],
    });
  });

  it('extracts project source files and captures source-file failures as warnings', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/src/Button.ts', 'export const Button = 1;');
    project.createSourceFile('/src/Input.ts', 'export const Input = 1;');

    const result = extractProjectSourceFiles(project, (sourceFile) => {
      if (sourceFile.getBaseName() === 'Input.ts') throw new Error('unsupported fixture');
      return [{ name: sourceFile.getBaseNameWithoutExtension() }];
    });

    expect(result.items).toEqual([{ name: 'Button' }]);
    expect(result.warnings).toEqual(['Failed to extract from /src/Input.ts: unsupported fixture']);
  });
});

describe('adapter support resolution', () => {
  it('resolves local TypeScript modules and JavaScript specifiers with fallback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'extraction-module-resolution-'));
    tempDirectories.push(directory);
    const importingFilePath = join(directory, 'entry.ts');
    const modulePath = join(directory, 'Widget.ts');
    const fallbackPath = join(directory, 'Fallback.ts');
    await writeFile(importingFilePath, '');
    await writeFile(modulePath, '');
    await writeFile(fallbackPath, '');

    expect(resolveLocalModule(importingFilePath, './Widget')).toBe(modulePath);
    expect(
      resolveLocalModule(importingFilePath, './Fallback.js', {
        allowJavaScriptExtensionFallback: true,
      }),
    ).toBe(fallbackPath);
    expect(resolveLocalModule(importingFilePath, './Missing')).toBeNull();
  });

  it('resolves type properties with declaration, type text, and requiredness', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      '/src/props.ts',
      ['interface Props {', '  label: string;', '  count?: number;', '}'].join('\n'),
    );
    const properties = sourceFile.getInterfaceOrThrow('Props').getType().getProperties();

    expect(resolveTypeProperty(properties.find((property) => property.getName() === 'label')!)).toEqual(
      expect.objectContaining({
        name: 'label',
        typeText: 'string',
        required: true,
      }),
    );
    expect(resolveTypeProperty(properties.find((property) => property.getName() === 'count')!)).toEqual(
      expect.objectContaining({
        name: 'count',
        typeText: 'number',
        required: false,
      }),
    );
  });

  it('extracts source line metadata from declarations and handles missing nodes', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      '/src/props.ts',
      ['interface Props {', '  label: string;', '}'].join('\n'),
    );
    const declaration = sourceFile.getInterfaceOrThrow('Props').getProperties()[0];

    expect(getSourceLineMetadata(declaration)).toEqual({
      sourceStartLine: 2,
      sourceEndLine: 2,
    });
    expect(getSourceLineMetadata(undefined)).toEqual({});
  });
});
