import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAccess } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, access: mockAccess };
});

import {
  detectSaveConflict,
  buildTimestampedSubdir,
  resolveSavePath,
} from '../../src/runs/save-path-resolver.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('detectSaveConflict', () => {
  it('returns true when components.json exists', async () => {
    mockAccess.mockImplementation(async (p: string) => {
      if (p.endsWith('components.json')) return undefined;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    expect(await detectSaveConflict('/tmp/foo')).toBe(true);
  });

  it('returns true when tokens.json exists', async () => {
    mockAccess.mockImplementation(async (p: string) => {
      if (p.endsWith('tokens.json')) return undefined;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    expect(await detectSaveConflict('/tmp/foo')).toBe(true);
  });

  it('returns false when neither file exists', async () => {
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    expect(await detectSaveConflict('/tmp/empty')).toBe(false);
  });
});

describe('buildTimestampedSubdir', () => {
  it('returns <base>/dsi-YYYYMMDD-HHMMSS', () => {
    const fixed = new Date('2026-06-25T14:31:07.000Z');
    const result = buildTimestampedSubdir('/tmp/foo', fixed);
    expect(result).toMatch(/^\/tmp\/foo\/dsi-\d{8}-\d{6}$/);
  });
});

describe('resolveSavePath', () => {
  it('returns no-conflict when neither file exists', async () => {
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const r = await resolveSavePath('/tmp/empty');
    expect(r).toEqual({ kind: 'no-conflict', path: '/tmp/empty' });
  });

  it('returns conflict when files exist', async () => {
    mockAccess.mockImplementation(async (p: string) => {
      if (p.endsWith('components.json')) return undefined;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const r = await resolveSavePath('/tmp/foo');
    expect(r).toEqual({ kind: 'conflict', path: '/tmp/foo' });
  });

  describe('with onConflict mode', () => {
    it('overwrite returns write at original path even when files exist', async () => {
      mockAccess.mockImplementation(async (p: string) => {
        if (p.endsWith('components.json')) return undefined;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      const r = await resolveSavePath('/tmp/foo', { onConflict: 'overwrite' });
      expect(r).toEqual({ kind: 'write', path: '/tmp/foo' });
    });

    it('overwrite returns write at original path when no files exist', async () => {
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const r = await resolveSavePath('/tmp/empty', { onConflict: 'overwrite' });
      expect(r).toEqual({ kind: 'write', path: '/tmp/empty' });
    });

    it('skip returns write at timestamped subdir when files exist', async () => {
      mockAccess.mockImplementation(async (p: string) => {
        if (p.endsWith('components.json')) return undefined;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      const fixed = new Date('2026-06-25T14:31:07.000Z');
      const r = await resolveSavePath('/tmp/foo', { onConflict: 'skip', now: fixed });
      expect(r.kind).toBe('write');
      if (r.kind === 'write') {
        expect(r.path).toMatch(/^\/tmp\/foo\/dsi-\d{8}-\d{6}$/);
      }
    });

    it('skip returns write at original path when no files exist', async () => {
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const r = await resolveSavePath('/tmp/empty', { onConflict: 'skip' });
      expect(r).toEqual({ kind: 'write', path: '/tmp/empty' });
    });

    it('fail returns fail result listing conflicting filenames when files exist', async () => {
      mockAccess.mockImplementation(async (p: string) => {
        if (p.endsWith('components.json') || p.endsWith('tokens.json')) return undefined;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      const r = await resolveSavePath('/tmp/foo', { onConflict: 'fail' });
      expect(r.kind).toBe('fail');
      if (r.kind === 'fail') {
        expect(r.conflict.path).toBe('/tmp/foo');
        expect(r.conflict.files).toEqual(
          expect.arrayContaining(['components.json', 'tokens.json']),
        );
      }
    });

    it('fail returns write at original path when no files exist', async () => {
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      const r = await resolveSavePath('/tmp/empty', { onConflict: 'fail' });
      expect(r).toEqual({ kind: 'write', path: '/tmp/empty' });
    });
  });
});
