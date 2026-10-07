import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { extractComponents } from '../../controller/extract-components-endpoint.js';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('extractComponents', () => {
  it('extracts a React component and returns it with warnings empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pipeline-extract-'));
    tempDirs.push(dir);
    const file = join(dir, 'Button.tsx');
    await writeFile(file, 'export function Button({ label }: { label: string }) { return <button>{label}</button>; }');

    const result = await extractComponents({ filePaths: [file], projectRoot: dir });

    expect(result.warnings).toEqual([]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({ name: 'Button' });
  });

  it('rejects empty filePaths before invoking extraction', async () => {
    await expect(extractComponents({ filePaths: ['   '] })).rejects.toThrow(
      'extractEndpoint requires filePaths to contain non-empty strings',
    );
  });

  it('calls onProgress with extraction phase updates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pipeline-extract-progress-'));
    tempDirs.push(dir);
    const file = join(dir, 'Card.tsx');
    await writeFile(file, 'export function Card({ title }: { title: string }) { return <div>{title}</div>; }');

    const progress: unknown[] = [];
    await extractComponents({ filePaths: [file], projectRoot: dir, onProgress: (p) => progress.push(p) });

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toMatchObject({ phase: 'extract', filesProcessed: 1 });
  });
});
