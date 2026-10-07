import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFiles } from '../helpers/collect-files.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `collect-files-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function write(rel: string, content = 'export {}') {
  const full = path.join(tmpDir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('collectFiles', () => {
  it('includes .ts files', () => {
    write('src/Button.ts');
    const files = collectFiles(tmpDir);
    expect(files.map((f) => path.basename(f.path))).toContain('Button.ts');
  });

  it('includes .tsx, .js, .jsx, .vue, .svelte, .astro files', () => {
    write('src/A.tsx');
    write('src/B.js');
    write('src/C.jsx');
    write('src/D.vue');
    write('src/E.svelte');
    write('src/F.astro');
    const files = collectFiles(tmpDir);
    const names = files.map((f) => path.basename(f.path));
    expect(names).toContain('A.tsx');
    expect(names).toContain('B.js');
    expect(names).toContain('C.jsx');
    expect(names).toContain('D.vue');
    expect(names).toContain('E.svelte');
    expect(names).toContain('F.astro');
  });

  it('excludes .d.ts files', () => {
    write('src/Button.d.ts');
    const files = collectFiles(tmpDir);
    expect(files.map((f) => path.basename(f.path))).not.toContain('Button.d.ts');
  });

  it('excludes .test.ts and .spec.ts files', () => {
    write('src/Button.test.ts');
    write('src/Button.spec.ts');
    const files = collectFiles(tmpDir);
    const names = files.map((f) => path.basename(f.path));
    expect(names).not.toContain('Button.test.ts');
    expect(names).not.toContain('Button.spec.ts');
  });

  it('excludes .stories.tsx files', () => {
    write('src/Button.stories.tsx');
    const files = collectFiles(tmpDir);
    expect(files.map((f) => path.basename(f.path))).not.toContain('Button.stories.tsx');
  });

  it('excludes node_modules and dist directories', () => {
    write('node_modules/some-pkg/index.ts');
    write('dist/bundle.js');
    write('src/App.ts');
    const files = collectFiles(tmpDir);
    const names = files.map((f) => path.basename(f.path));
    expect(names).toContain('App.ts');
    expect(names).not.toContain('index.ts');
    expect(names).not.toContain('bundle.js');
  });

  it('returns file content', () => {
    write('src/Button.ts', 'export const x = 1;');
    const files = collectFiles(tmpDir);
    const btn = files.find((f) => path.basename(f.path) === 'Button.ts');
    expect(btn?.content).toBe('export const x = 1;');
  });

  it('throws when root is not a directory', () => {
    const file = path.join(tmpDir, 'not-a-dir.ts');
    writeFileSync(file, '');
    expect(() => collectFiles(file)).toThrow();
  });
});
