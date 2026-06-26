import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'node:os';
import { resolve as resolvePath } from 'node:path';

const { mockGetRun, mockFindAllBySavePath } = vi.hoisted(() => ({
  mockGetRun: vi.fn(),
  mockFindAllBySavePath: vi.fn(),
}));

vi.mock('../../src/runs/store.js', () => ({
  getRun: mockGetRun,
  findAllRunsBySavePath: mockFindAllBySavePath,
}));

import { resolveRunTarget } from '../../src/runs/resolve-run-target.js';
import type { RunRecord } from '../../src/runs/store.js';

const sampleRun = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: '01HXYZABCDEFGHJKMNPQRSTVWXY',
  createdAt: '2026-06-24T14:31:00.000Z',
  projectPath: '/p',
  savePath: '/p/dist',
  componentCount: 3,
  tokenCount: 4,
  agent: 'claude',
  pushedTo: null,
  extractSessionId: 'e1',
  generateSessionId: 'g1',
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('resolveRunTarget', () => {
  it('treats an arg starting with / as a path and looks up by savePath', async () => {
    const run = sampleRun({ savePath: '/abs/dist' });
    mockFindAllBySavePath.mockResolvedValueOnce([run]);
    const result = await resolveRunTarget('/abs/dist');
    expect(mockFindAllBySavePath).toHaveBeenCalledWith('/abs/dist');
    expect(mockGetRun).not.toHaveBeenCalled();
    expect(result).toBe(run);
  });

  it('treats an arg starting with ./ as a path relative to cwd', async () => {
    const expected = resolvePath(process.cwd(), './sub');
    const run = sampleRun({ savePath: expected });
    mockFindAllBySavePath.mockResolvedValueOnce([run]);
    const result = await resolveRunTarget('./sub');
    expect(mockFindAllBySavePath).toHaveBeenCalledWith(expected);
    expect(result).toBe(run);
  });

  it('expands ~/ to $HOME', async () => {
    const expected = resolvePath(homedir(), 'work/dist');
    const run = sampleRun({ savePath: expected });
    mockFindAllBySavePath.mockResolvedValueOnce([run]);
    const result = await resolveRunTarget('~/work/dist');
    expect(mockFindAllBySavePath).toHaveBeenCalledWith(expected);
    expect(result).toBe(run);
  });

  it('treats . as cwd', async () => {
    const expected = resolvePath(process.cwd());
    const run = sampleRun({ savePath: expected });
    mockFindAllBySavePath.mockResolvedValueOnce([run]);
    const result = await resolveRunTarget('.');
    expect(mockFindAllBySavePath).toHaveBeenCalledWith(expected);
    expect(result).toBe(run);
  });

  it('treats a bare token as a run-id and calls getRun', async () => {
    const run = sampleRun();
    mockGetRun.mockResolvedValueOnce(run);
    const result = await resolveRunTarget('01HXYZABCDEFGHJKMNPQRSTVWXY');
    expect(mockGetRun).toHaveBeenCalledWith('01HXYZABCDEFGHJKMNPQRSTVWXY');
    expect(mockFindAllBySavePath).not.toHaveBeenCalled();
    expect(result).toBe(run);
  });

  it('errors when the path has no matching run', async () => {
    mockFindAllBySavePath.mockResolvedValueOnce([]);
    await expect(resolveRunTarget('/nope')).rejects.toThrow(
      "No run recorded for path /nope. Run 'experiences runs' to list known runs.",
    );
  });

  it('picks the newest by createdAt when multiple matches and logs stderr', async () => {
    const older = sampleRun({ id: 'OLDER', createdAt: '2026-06-01T00:00:00.000Z' });
    const newer = sampleRun({ id: 'NEWER', createdAt: '2026-06-20T00:00:00.000Z' });
    const oldest = sampleRun({ id: 'OLDEST', createdAt: '2026-05-01T00:00:00.000Z' });
    mockFindAllBySavePath.mockResolvedValueOnce([older, newer, oldest]);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await resolveRunTarget('/abs/dist');
    expect(result.id).toBe('NEWER');
    const msg = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(msg).toContain(
      'Multiple runs at /abs/dist; using newest NEWER (createdAt 2026-06-20T00:00:00.000Z). 2 older candidates ignored.',
    );
    stderr.mockRestore();
  });

  it('does not log stderr noise when there is a single match', async () => {
    const run = sampleRun({ savePath: '/abs/dist' });
    mockFindAllBySavePath.mockResolvedValueOnce([run]);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await resolveRunTarget('/abs/dist');
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
  });
});
