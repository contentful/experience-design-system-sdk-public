import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAccess, mockAppendRun } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockAppendRun: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, access: mockAccess };
});

vi.mock('../../../src/runs/store.js', () => ({
  appendRun: mockAppendRun,
}));

import { planSaveFlow, recordRunAfterSave } from '../../../src/import/tui/wizard-save-flow.js';

beforeEach(() => {
  vi.resetAllMocks();
  mockAppendRun.mockResolvedValue({ id: '01HXYZ', createdAt: '2026-06-25T00:00:00.000Z' });
});

describe('planSaveFlow', () => {
  it('bypasses prompt when outDirOverride is set (--out-dir)', async () => {
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const r = await planSaveFlow({ defaultPath: '/d', outDirOverride: '/override' });
    expect(r).toEqual({ kind: 'write', path: '/override' });
  });

  it('bypasses prompt + treats override as already-resolved (no conflict probe)', async () => {
    mockAccess.mockImplementation(async () => undefined); // existing files
    const r = await planSaveFlow({ defaultPath: '/d', outDirOverride: '/override' });
    expect(r).toEqual({ kind: 'write', path: '/override' });
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it('opens path prompt when no override', async () => {
    const r = await planSaveFlow({ defaultPath: '/d' });
    expect(r).toEqual({ kind: 'prompt', defaultPath: '/d' });
  });
});

describe('recordRunAfterSave', () => {
  it('appends a run record with the chosen save path', async () => {
    await recordRunAfterSave({
      projectPath: '/work/foo',
      savePath: '/work/foo/dist',
      componentCount: 5,
      tokenCount: 12,
      tokensPath: '/work/foo/dist/tokens.json',
      tokenSessionId: 't1',
      agent: 'claude',
      pushedTo: null,
      extractSessionId: 'e1',
      generateSessionId: 'g1',
    });
    expect(mockAppendRun).toHaveBeenCalledWith(
      expect.objectContaining({
        savePath: '/work/foo/dist',
        projectPath: '/work/foo',
        componentCount: 5,
        agent: 'claude',
      }),
    );
  });

  it('returns the new record id', async () => {
    const r = await recordRunAfterSave({
      projectPath: '/p',
      savePath: '/p/d',
      componentCount: 1,
      tokenCount: 1,
      tokensPath: null,
      tokenSessionId: null,
      agent: 'claude',
      pushedTo: null,
      extractSessionId: 'e',
      generateSessionId: null,
    });
    expect(r.id).toBe('01HXYZ');
  });
});
