import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { extractEndpoint } from '../src/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('extractEndpoint', () => {
  it('returns validated components and typed progress without owning persistence', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-endpoint-'));
    tempDirs.push(projectRoot);
    const sourcePath = join(projectRoot, 'Button.tsx');
    await writeFile(
      sourcePath,
      'export function Button({ label }: { label: string }) { return <button>{label}</button>; }',
    );
    const progress: Array<{ phase: 'extract'; filesProcessed: number; totalFiles: number; componentsFound: number }> =
      [];

    const result = await extractEndpoint({
      filePaths: [sourcePath],
      projectRoot,
      onProgress: (update) => progress.push(update),
    });

    expect(result.warnings).toEqual([]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({ name: 'Button', source: sourcePath, validationIssues: [] });
    expect(progress.at(-1)).toEqual({
      phase: 'extract',
      filesProcessed: 1,
      totalFiles: 1,
      componentsFound: 1,
    });
  });

  it('preserves non-authorable signals as reviewable output instead of silently dropping components', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-endpoint-review-'));
    tempDirs.push(projectRoot);
    const sourcePath = join(projectRoot, 'AnalyticsBridge.tsx');
    await writeFile(
      sourcePath,
      'export function AnalyticsBridge({ onTrack }: { onTrack: () => void }) { return null; }',
    );

    const result = await extractEndpoint({ filePaths: [sourcePath], projectRoot });

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.needsReview).toBe(true);
    expect(result.components[0]?.reviewReasons).toContain('non-authorable:component has no props and no slots');
    expect(result.warnings).toContain(
      'AnalyticsBridge: requires operator review (component has no props and no slots)',
    );
  });

  it('rejects malformed endpoint input before invoking extraction', async () => {
    await expect(extractEndpoint({ filePaths: ['   '] })).rejects.toThrow(
      'extractEndpoint requires filePaths to contain non-empty strings',
    );
  });
});
