import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectSourceFiles } from '../../../src/analyze/services/collect-source-files.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'collect-src-'));
  await writeFile(join(dir, 'Button.tsx'), '');
  await writeFile(join(dir, 'Card.vue'), '');
  await writeFile(join(dir, 'component.stories.tsx'), '');
  await writeFile(join(dir, 'component.test.ts'), '');
  await writeFile(join(dir, 'package.json'), '{}');
  await writeFile(join(dir, 'tsconfig.json'), '{}');
  await writeFile(join(dir, 'README.md'), '');
  await mkdir(join(dir, 'node_modules'));
  await writeFile(join(dir, 'node_modules', 'dep.ts'), '');
  await mkdir(join(dir, 'dist'));
  await writeFile(join(dir, 'dist', 'out.ts'), '');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('collectSourceFiles', () => {
  it('includes .tsx and .vue source files', async () => {
    const files = await collectSourceFiles(dir);
    expect(files.some((f) => f.endsWith('Button.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('Card.vue'))).toBe(true);
  });

  it('excludes .stories.tsx files', async () => {
    const files = await collectSourceFiles(dir);
    expect(files.some((f) => f.includes('.stories.'))).toBe(false);
  });

  it('excludes .test.ts files', async () => {
    const files = await collectSourceFiles(dir);
    expect(files.some((f) => f.includes('.test.'))).toBe(false);
  });

  it('excludes node_modules and dist directories', async () => {
    const files = await collectSourceFiles(dir);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.includes('/dist/'))).toBe(false);
  });

  it('excludes package.json and tsconfig.json', async () => {
    const files = await collectSourceFiles(dir);
    expect(files.some((f) => f.endsWith('package.json'))).toBe(false);
    expect(files.some((f) => f.endsWith('tsconfig.json'))).toBe(false);
  });

  it('excludes README.md', async () => {
    const files = await collectSourceFiles(dir);
    expect(files.some((f) => f.endsWith('README.md'))).toBe(false);
  });

  it('calls onProgress with running count', async () => {
    const counts: number[] = [];
    await collectSourceFiles(dir, (n) => counts.push(n));
    expect(counts.length).toBeGreaterThan(0);
    expect(counts[counts.length - 1]).toBe(counts.length);
  });

  it('returns files in sorted order', async () => {
    const files = await collectSourceFiles(dir);
    expect(files).toEqual([...files].sort());
  });
});
