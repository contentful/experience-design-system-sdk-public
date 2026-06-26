import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');

// ── Integration: parse-time mutex errors (real CLI) ────────────────────────

function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((res) => {
    execFile('node', [bin, ...args], { env: { ...process.env } }, (error, stdout, stderr) => {
      res({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}

describe('experiences import --on-conflict — parse-time mutex errors', () => {
  it('errors when --no-save and --on-conflict are combined', async () => {
    const { stderr, code } = await run([
      'import',
      '--no-save',
      '--on-conflict',
      'overwrite',
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--no-save.*--on-conflict|--on-conflict.*--no-save/);
  });

  it('errors with invalid --on-conflict value', async () => {
    const { stderr, code } = await run([
      'import',
      '--skip-analyze',
      '--skip-generate',
      '--skip-apply',
      '--on-conflict',
      'bogus',
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/on-conflict|overwrite|skip|fail/i);
  });

  it('lists --on-conflict in --help', async () => {
    const { stdout, code } = await run(['import', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--on-conflict');
  });
});

// ── Unit: planSaveFlow honours --on-conflict ──────────────────────────────

const { mockAccess } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, access: mockAccess };
});

import { planSaveFlow } from '../../src/import/tui/wizard-save-flow.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('planSaveFlow — onConflict mode bypasses the gate', () => {
  it('overwrite + existing files → write at original path (no gate)', async () => {
    mockAccess.mockImplementation(async (p: string) => {
      if (p.endsWith('components.json')) return undefined;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const r = await planSaveFlow({
      defaultPath: '/d',
      outDirOverride: '/existing',
      onConflict: 'overwrite',
    });
    expect(r).toEqual({ kind: 'write', path: '/existing' });
  });

  it('skip + existing files → write at timestamped subdir', async () => {
    mockAccess.mockImplementation(async (p: string) => {
      if (p.endsWith('components.json')) return undefined;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const r = await planSaveFlow({
      defaultPath: '/d',
      outDirOverride: '/existing',
      onConflict: 'skip',
    });
    expect(r.kind).toBe('write');
    if (r.kind === 'write') {
      expect(r.path).toMatch(/^\/existing\/dsi-\d{8}-\d{6}$/);
    }
  });

  it('fail + existing files → fail result with conflicting filenames', async () => {
    mockAccess.mockImplementation(async (p: string) => {
      if (p.endsWith('components.json') || p.endsWith('tokens.json')) return undefined;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const r = await planSaveFlow({
      defaultPath: '/d',
      outDirOverride: '/existing',
      onConflict: 'fail',
    });
    expect(r.kind).toBe('fail');
    if (r.kind === 'fail') {
      expect(r.conflict.path).toBe('/existing');
      expect(r.conflict.files.length).toBeGreaterThan(0);
    }
  });

  it('overwrite + no existing files → write at original path', async () => {
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const r = await planSaveFlow({
      defaultPath: '/d',
      outDirOverride: '/fresh',
      onConflict: 'overwrite',
    });
    expect(r).toEqual({ kind: 'write', path: '/fresh' });
  });

  it('no override + onConflict still opens path prompt (flag applies after prompt)', async () => {
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const r = await planSaveFlow({
      defaultPath: '/d',
      onConflict: 'overwrite',
    });
    expect(r).toEqual({ kind: 'prompt', defaultPath: '/d' });
  });
});
