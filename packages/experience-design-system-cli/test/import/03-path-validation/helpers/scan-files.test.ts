import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  foldSvelteAndMdIntoOther,
  scanFiles,
  toScanResult,
} from '../../../../src/tui/import/steps/03-path-validation/helpers/scan-files.js';

describe('scanFiles', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eds-scan-'));
  });

  afterEach(async () => {
    await chmod(root, 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  it('counts files in nested folders by type', async () => {
    await mkdir(join(root, 'src', 'ui'), { recursive: true });
    await writeFile(join(root, 'src', 'ui', 'Button.tsx'), '');
    await writeFile(join(root, 'src', 'index.ts'), '');
    await writeFile(join(root, 'tokens.json'), '{}');
    await writeFile(join(root, 'notes.md'), '# notes');

    expect(scanFiles(root)).toMatchObject({
      ok: true,
      counts: { tsx: 1, ts: 1, vue: 0, astro: 0, jsx: 0, js: 0, json: 1, other: 1, total: 4 },
    });
  });

  it('skips node_modules, dist and other ignored folders', async () => {
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), '');
    await writeFile(join(root, 'dist', 'bundle.js'), '');
    await writeFile(join(root, 'App.tsx'), '');

    expect(scanFiles(root)).toMatchObject({ ok: true, counts: { tsx: 1, js: 0, total: 1 } });
  });

  it('does not follow symlinks when counting files', async () => {
    await writeFile(join(root, 'real.tsx'), '');
    await symlink(join(root, 'real.tsx'), join(root, 'link.tsx'));

    expect(scanFiles(root)).toMatchObject({ ok: true, counts: { tsx: 1 } });
  });

  it('reports a missing directory', () => {
    expect(scanFiles(join(root, 'nope'))).toEqual({ ok: false, failure: 'not-found' });
  });

  it('reports a file passed instead of a directory', async () => {
    const file = join(root, 'a.tsx');
    await writeFile(file, '');

    expect(scanFiles(file)).toEqual({ ok: false, failure: 'is-file' });
  });

  it('returns zero counts for an empty directory', () => {
    expect(scanFiles(root)).toMatchObject({ ok: true, counts: { total: 0 } });
  });
});

describe('toScanResult', () => {
  it('maps a successful outcome to an ok ScanResult with folded counts, filePaths and warnings', () => {
    expect(
      toScanResult({
        ok: true,
        result: {
          counts: {
            tsx: 2,
            ts: 1,
            vue: 0,
            astro: 0,
            jsx: 0,
            js: 0,
            json: 1,
            svelte: 1,
            md: 1,
            other: 0,
            total: 6,
          },
          filePaths: ['/a/Button.tsx', '/a/notes.md'],
          warnings: ['one warning'],
        },
      }),
    ).toEqual({
      ok: true,
      counts: { tsx: 2, ts: 1, vue: 0, astro: 0, jsx: 0, js: 0, json: 1, other: 2, total: 6 },
      filePaths: ['/a/Button.tsx', '/a/notes.md'],
      warnings: ['one warning'],
    });
  });

  it('forwards a failure outcome unchanged', () => {
    expect(toScanResult({ ok: false, failure: 'not-found' })).toEqual({ ok: false, failure: 'not-found' });
  });
});

describe('foldSvelteAndMdIntoOther', () => {
  it('adds svelte and md counts into other and keeps everything else as-is', () => {
    expect(
      foldSvelteAndMdIntoOther({
        tsx: 10,
        ts: 4,
        vue: 2,
        astro: 1,
        jsx: 0,
        js: 3,
        json: 5,
        svelte: 6,
        md: 2,
        other: 1,
        total: 34,
      }),
    ).toEqual({
      tsx: 10,
      ts: 4,
      vue: 2,
      astro: 1,
      jsx: 0,
      js: 3,
      json: 5,
      other: 9,
      total: 34,
    });
  });

  it('does not change other when there are no svelte or md files', () => {
    expect(
      foldSvelteAndMdIntoOther({
        tsx: 1,
        ts: 0,
        vue: 0,
        astro: 0,
        jsx: 0,
        js: 0,
        json: 0,
        svelte: 0,
        md: 0,
        other: 1,
        total: 2,
      }).other,
    ).toBe(1);
  });
});
