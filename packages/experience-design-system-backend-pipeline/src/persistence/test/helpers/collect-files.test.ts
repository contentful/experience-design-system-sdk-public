import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFiles } from '../../src/helpers/collect-files/index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `collect-files-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function basenames(outcome: ReturnType<typeof collectFiles>): string[] {
  if (!outcome.ok) throw new Error(`expected ok outcome, got failure: ${outcome.failure}`);
  return outcome.result.filePaths.map((p) => path.basename(p));
}

describe('collectFiles — included extensions', () => {
  it('includes .ts files', () => {
    write('src/Button.ts');
    expect(basenames(collectFiles(tmpDir))).toContain('Button.ts');
  });

  it('includes .tsx, .js, .jsx, .vue, .svelte, .astro files', () => {
    write('src/A.tsx');
    write('src/B.js');
    write('src/C.jsx');
    write('src/D.vue');
    write('src/E.svelte');
    write('src/F.astro');
    const names = basenames(collectFiles(tmpDir));
    expect(names).toEqual(expect.arrayContaining(['A.tsx', 'B.js', 'C.jsx', 'D.vue', 'E.svelte', 'F.astro']));
  });
});

describe('collectFiles — denylist-gated extensions (.json / .md)', () => {
  it('includes a generic .json file but excludes package.json', () => {
    write('src/manifest.json', '{}');
    write('package.json', '{}');
    const names = basenames(collectFiles(tmpDir));
    expect(names).toContain('manifest.json');
    expect(names).not.toContain('package.json');
  });

  it('excludes tsconfig*.json and eslint config files', () => {
    write('tsconfig.json', '{}');
    write('tsconfig.build.json', '{}');
    write('.eslintrc.json', '{}');
    const names = basenames(collectFiles(tmpDir));
    expect(names).not.toEqual(expect.arrayContaining(['tsconfig.json', 'tsconfig.build.json', '.eslintrc.json']));
  });

  it('includes AGENTS.md but excludes README.md', () => {
    write('AGENTS.md', '#');
    write('README.md', '#');
    const names = basenames(collectFiles(tmpDir));
    expect(names).toContain('AGENTS.md');
    expect(names).not.toContain('README.md');
  });
});

describe('collectFiles — excluded suffixes', () => {
  it('excludes .d.ts', () => {
    write('src/Button.d.ts');
    expect(basenames(collectFiles(tmpDir))).not.toContain('Button.d.ts');
  });

  it('excludes test/spec/story/stories across .ts/.tsx/.js/.jsx', () => {
    write('src/Button.test.ts');
    write('src/Button.spec.tsx');
    write('src/Button.stories.jsx');
    write('src/Button.story.js');
    const names = basenames(collectFiles(tmpDir));
    expect(names).not.toEqual(
      expect.arrayContaining(['Button.test.ts', 'Button.spec.tsx', 'Button.stories.jsx', 'Button.story.js']),
    );
  });
});

describe('collectFiles — ignored dirs', () => {
  it('skips the full legacy ignore list (node_modules, dist, demo, examples, .nuxt, storybook-static, out, …)', () => {
    for (const dir of [
      'node_modules/some-pkg',
      'dist',
      'build',
      'coverage',
      '.next',
      '.nuxt',
      '.changeset',
      '.github',
      '.idea',
      '.vscode',
      'demo',
      'demos',
      'example',
      'examples',
      'out',
      'storybook-static',
    ]) {
      write(`${dir}/Should.ts`);
    }
    write('src/Keeper.ts');
    const names = basenames(collectFiles(tmpDir));
    expect(names).toContain('Keeper.ts');
    expect(names).not.toContain('Should.ts');
  });
});

describe('collectFiles — counts', () => {
  it('tallies per-category + total', () => {
    write('src/A.tsx');
    write('src/B.tsx');
    write('src/C.ts');
    write('src/D.vue');
    write('src/E.svelte');
    write('src/F.json', '{}');
    const outcome = collectFiles(tmpDir);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.result.counts.tsx).toBe(2);
    expect(outcome.result.counts.ts).toBe(1);
    expect(outcome.result.counts.vue).toBe(1);
    expect(outcome.result.counts.svelte).toBe(1);
    expect(outcome.result.counts.json).toBe(1);
    expect(outcome.result.counts.total).toBe(6);
  });
});

describe('collectFiles — warnings', () => {
  it('warns when zero source files found', () => {
    const outcome = collectFiles(tmpDir);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.result.warnings).toContainEqual(expect.stringMatching(/no source files found/i));
  });

  it('warns when no framework files but other files exist', () => {
    write('src/notes.json', '{}');
    const outcome = collectFiles(tmpDir);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.result.warnings).toContainEqual(expect.stringMatching(/no framework source files/i));
  });

  it('no warnings when a healthy project is scanned', () => {
    write('src/App.tsx');
    const outcome = collectFiles(tmpDir);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.result.warnings).toEqual([]);
  });
});

describe('collectFiles — typed failures', () => {
  it('returns not-found when the path does not exist', () => {
    const outcome = collectFiles(path.join(tmpDir, 'nope'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.failure).toBe('not-found');
  });

  it('returns is-file when the path points at a regular file', () => {
    const file = path.join(tmpDir, 'not-a-dir.ts');
    writeFileSync(file, '');
    const outcome = collectFiles(file);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.failure).toBe('is-file');
  });
});

describe('collectFiles — includeContent flag', () => {
  it('does not read contents by default', () => {
    write('src/Button.ts', 'export const x = 1;');
    const outcome = collectFiles(tmpDir);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.result.candidateFiles).toBeUndefined();
  });

  it('populates candidateFiles with { path, content } when includeContent: true', () => {
    write('src/Button.ts', 'export const x = 1;');
    const outcome = collectFiles(tmpDir, { includeContent: true });
    if (!outcome.ok) throw new Error('expected ok');
    const btn = outcome.result.candidateFiles?.find((f) => path.basename(f.path) === 'Button.ts');
    expect(btn?.content).toBe('export const x = 1;');
  });
});
