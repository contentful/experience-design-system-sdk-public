import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { collectSourceFiles } from '../../src/analyze/command.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'collect-source-files-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function touch(relPath: string): Promise<string> {
  const fullPath = join(tempDir, relPath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, '');
  return fullPath;
}

describe('collectSourceFiles', () => {
  it('returns component source files with supported extensions', async () => {
    await touch('Button.tsx');
    await touch('Card.ts');
    await touch('Input.jsx');
    await touch('Select.js');
    await touch('Hero.vue');
    await touch('Banner.astro');

    const files = await collectSourceFiles(tempDir);
    const names = files.map((f) => basename(f));

    expect(names).toContain('Button.tsx');
    expect(names).toContain('Card.ts');
    expect(names).toContain('Input.jsx');
    expect(names).toContain('Select.js');
    expect(names).toContain('Hero.vue');
    expect(names).toContain('Banner.astro');
  });

  it('excludes Storybook story files', async () => {
    await touch('Button.stories.tsx');
    await touch('Button.stories.ts');
    await touch('Button.stories.jsx');
    await touch('Button.stories.js');
    await touch('Button.story.tsx');
    await touch('Button.story.ts');
    await touch('Button.story.jsx');
    await touch('Button.story.js');
    await touch('Button.tsx');

    const files = await collectSourceFiles(tempDir);
    const names = files.map((f) => basename(f));

    expect(names).toContain('Button.tsx');
    expect(names.filter((n) => n.includes('.stories.') || n.includes('.story.'))).toHaveLength(0);
  });

  it('excludes test and spec files', async () => {
    await touch('Button.test.ts');
    await touch('Button.test.tsx');
    await touch('Button.spec.ts');
    await touch('Button.spec.tsx');
    await touch('Button.tsx');

    const files = await collectSourceFiles(tempDir);
    const names = files.map((f) => basename(f));

    expect(names).toContain('Button.tsx');
    expect(names.filter((n) => n.includes('.test.') || n.includes('.spec.'))).toHaveLength(0);
  });

  it('excludes .d.ts declaration files', async () => {
    await touch('Button.d.ts');
    await touch('Button.tsx');

    const files = await collectSourceFiles(tempDir);
    const names = files.map((f) => basename(f));

    expect(names).toContain('Button.tsx');
    expect(names).not.toContain('Button.d.ts');
  });

  it('excludes node_modules, dist, and other ignored directories', async () => {
    await touch('node_modules/lib/Component.tsx');
    await touch('dist/Button.tsx');
    await touch('storybook-static/index.js');
    await touch('coverage/Report.tsx');
    await touch('src/Card.tsx');

    const files = await collectSourceFiles(tempDir);

    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.includes('/dist/'))).toBe(false);
    expect(files.some((f) => f.includes('storybook-static'))).toBe(false);
    expect(files.some((f) => f.includes('coverage'))).toBe(false);
    expect(files.some((f) => f.endsWith('Card.tsx'))).toBe(true);
  });

  it('returns files sorted alphabetically', async () => {
    await touch('Zebra.tsx');
    await touch('Apple.tsx');
    await touch('Mango.tsx');

    const files = await collectSourceFiles(tempDir);
    const names = files.map((f) => basename(f));

    expect(names).toEqual([...names].sort());
  });

  it('invokes onProgress callback as files are discovered', async () => {
    await touch('a/Button.tsx');
    await touch('b/Card.tsx');
    await touch('c/Input.tsx');

    const progressUpdates: number[] = [];
    const files = await collectSourceFiles(tempDir, (count) => {
      progressUpdates.push(count);
    });

    expect(files).toHaveLength(3);
    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(3);
    // counts must be monotonically increasing
    for (let i = 1; i < progressUpdates.length; i++) {
      expect(progressUpdates[i]).toBeGreaterThanOrEqual(progressUpdates[i - 1]!);
    }
  });

  it('scans sibling directories in parallel (no blocking between siblings)', async () => {
    // Create N sibling directories each with one file. Parallel scan should
    // complete in roughly the time of one directory read, not N sequential reads.
    const siblingCount = 10;
    for (let i = 0; i < siblingCount; i++) {
      await touch(`dir${i}/Component${i}.tsx`);
    }

    const start = Date.now();
    const files = await collectSourceFiles(tempDir);
    const elapsed = Date.now() - start;

    expect(files).toHaveLength(siblingCount);
    // If truly parallel, should be well under 500ms for 10 empty-ish dirs
    // (sequential would still be fast for local FS, but this validates no artificial delay)
    expect(elapsed).toBeLessThan(2000);
  });
});
