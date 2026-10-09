import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanProject } from '../../src/tui/import/steps/03-path-validation/loader.js';

describe('scanProject', () => {
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

    const result = await scanProject(root);

    expect(result).toMatchObject({
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

    const result = await scanProject(root);

    expect(result).toMatchObject({ ok: true, counts: { tsx: 1, js: 0, total: 1 } });
  });

  it('does not follow symlinks when counting files', async () => {
    await writeFile(join(root, 'real.tsx'), '');
    await symlink(join(root, 'real.tsx'), join(root, 'link.tsx'));

    expect(await scanProject(root)).toMatchObject({ ok: true, counts: { tsx: 1 } });
  });

  it('reports a missing directory', async () => {
    expect(await scanProject(join(root, 'nope'))).toEqual({ ok: false, failure: 'not-found' });
  });

  it('reports a file passed instead of a directory', async () => {
    const file = join(root, 'a.tsx');
    await writeFile(file, '');

    expect(await scanProject(file)).toEqual({ ok: false, failure: 'is-file' });
  });

  it('returns zero counts for an empty directory', async () => {
    expect(await scanProject(root)).toMatchObject({ ok: true, counts: { total: 0 } });
  });
});
