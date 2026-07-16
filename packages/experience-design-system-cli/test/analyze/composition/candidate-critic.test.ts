import { describe, it, expect, vi } from 'vitest';
import {
  uncoveredDirectories,
  expandCandidatesByDirs,
  critiqueCandidates,
} from '../../../src/analyze/composition/candidate-critic.js';

const f = (p: string) => ({ path: p, content: '' });

describe('uncoveredDirectories', () => {
  it('lists directories present in all-files but absent from the selected set', () => {
    const all = [f('src/mapping/a.ts'), f('src/registry/b.ts'), f('src/widgets/c.ts'), f('src/utils/d.ts')];
    const selected = [f('src/mapping/a.ts')];
    const dirs = uncoveredDirectories(all, selected);
    expect(dirs).toContain('src/registry');
    expect(dirs).toContain('src/widgets');
    expect(dirs).toContain('src/utils');
    expect(dirs).not.toContain('src/mapping'); // already covered
  });

  it('dedupes and sorts', () => {
    const all = [f('a/x.ts'), f('a/y.ts'), f('b/z.ts')];
    const dirs = uncoveredDirectories(all, []);
    expect(dirs).toEqual(['a', 'b']);
  });

  it('returns empty when every directory is already covered', () => {
    const all = [f('src/mapping/a.ts')];
    expect(uncoveredDirectories(all, all)).toEqual([]);
  });
});

describe('expandCandidatesByDirs', () => {
  it('adds all-files whose directory is in the chosen set, without duplicating selected ones', () => {
    const all = [f('src/mapping/a.ts'), f('src/registry/b.ts'), f('src/registry/c.ts'), f('src/utils/d.ts')];
    const selected = [f('src/mapping/a.ts')];
    const expanded = expandCandidatesByDirs(all, selected, ['src/registry']);
    const paths = expanded.map((x) => x.path).sort();
    expect(paths).toEqual(['src/mapping/a.ts', 'src/registry/b.ts', 'src/registry/c.ts']);
  });

  it('ignores chosen dirs that do not exist / add nothing', () => {
    const all = [f('src/mapping/a.ts')];
    const selected = [f('src/mapping/a.ts')];
    expect(expandCandidatesByDirs(all, selected, ['nope']).map((x) => x.path)).toEqual(['src/mapping/a.ts']);
  });
});

describe('critiqueCandidates', () => {
  const all = [f('src/mapping/a.ts'), f('src/registry/b.ts'), f('src/utils/d.ts')];
  const selected = [f('src/mapping/a.ts')];

  it('asks the agent about uncovered dirs and folds in the ones it flags', async () => {
    const askDirs = vi.fn(async (dirs: string[]) => {
      expect(dirs).toContain('src/registry');
      expect(dirs).toContain('src/utils');
      return ['src/registry']; // agent judges registry promising, utils not
    });
    const { files, addedDirs } = await critiqueCandidates(all, selected, askDirs);
    expect(addedDirs).toEqual(['src/registry']);
    expect(files.map((x) => x.path).sort()).toEqual(['src/mapping/a.ts', 'src/registry/b.ts']);
  });

  it('is a no-op when there are no uncovered dirs (agent not called)', async () => {
    const askDirs = vi.fn(async () => []);
    const { files, addedDirs } = await critiqueCandidates(all, all, askDirs);
    expect(askDirs).not.toHaveBeenCalled();
    expect(addedDirs).toEqual([]);
    expect(files).toHaveLength(all.length);
  });

  it('ignores agent-returned dirs that were not offered (no injection)', async () => {
    const askDirs = vi.fn(async () => ['src/registry', 'src/EVIL-not-offered']);
    const { addedDirs } = await critiqueCandidates(all, selected, askDirs);
    expect(addedDirs).toEqual(['src/registry']);
  });

  it('tolerates the agent throwing — falls back to the original selection', async () => {
    const askDirs = vi.fn(async () => {
      throw new Error('agent boom');
    });
    const { files, addedDirs } = await critiqueCandidates(all, selected, askDirs);
    expect(addedDirs).toEqual([]);
    expect(files.map((x) => x.path)).toEqual(['src/mapping/a.ts']);
  });
});
