import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  // Stubs for other store imports — not used by the mount helper but needed
  // because store.ts pulls them in at module load.
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  chmod: vi.fn(),
}));

import { shouldShowRunPicker, type RunPickerFlags } from '../../src/runs/run-picker-mount.js';
import { RUNS_FILE_VERSION, type RunRecord } from '../../src/runs/store.js';

function makeRun(id: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    createdAt: '2026-06-25T14:31:00.000Z',
    projectPath: '/work/foo',
    savePath: '/work/foo/dist',
    componentCount: 3,
    tokenCount: 12,
    tokensPath: null,
    tokenSessionId: null,
    agent: 'claude',
    pushedTo: null,
    extractSessionId: 'extract-abc',
    generateSessionId: 'generate-abc',
    ...overrides,
  };
}

const NO_FLAGS: RunPickerFlags = {};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('shouldShowRunPicker', () => {
  it('returns shouldShow=false when runs.json does not exist', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(err);
    const result = await shouldShowRunPicker({
      flags: NO_FLAGS,
      isTTY: true,
      runsJsonPath: '/fake/runs.json',
    });
    expect(result.shouldShow).toBe(false);
    expect(result.runs).toEqual([]);
  });

  it('returns shouldShow=false when runs.json is empty', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ version: RUNS_FILE_VERSION, runs: [] }));
    const result = await shouldShowRunPicker({
      flags: NO_FLAGS,
      isTTY: true,
      runsJsonPath: '/fake/runs.json',
    });
    expect(result.shouldShow).toBe(false);
    expect(result.runs).toEqual([]);
  });

  it('returns shouldShow=true with the runs when file has entries and no conflicting flags', async () => {
    const runs = [makeRun('A'), makeRun('B')];
    mockReadFile.mockResolvedValue(JSON.stringify({ version: RUNS_FILE_VERSION, runs }));
    const result = await shouldShowRunPicker({
      flags: NO_FLAGS,
      isTTY: true,
      runsJsonPath: '/fake/runs.json',
    });
    expect(result.shouldShow).toBe(true);
    expect(result.runs.map((r) => r.id)).toEqual(['A', 'B']);
  });

  it.each([
    ['pushFromRun', { pushFromRun: 'ABC' } as RunPickerFlags],
    ['modify', { modify: 'ABC' } as RunPickerFlags],
    ['project', { project: '/some/path' } as RunPickerFlags],
    ['autoAcceptScope', { autoAcceptScope: true } as RunPickerFlags],
    ['printPrompt', { printPrompt: true } as RunPickerFlags],
    ['dryRun', { dryRun: true } as RunPickerFlags],
  ])('returns shouldShow=false when --%s is set', async (_label, flags) => {
    mockReadFile.mockResolvedValue(JSON.stringify({ version: RUNS_FILE_VERSION, runs: [makeRun('A')] }));
    const result = await shouldShowRunPicker({
      flags,
      isTTY: true,
      runsJsonPath: '/fake/runs.json',
    });
    expect(result.shouldShow).toBe(false);
  });

  it('returns shouldShow=true for a v1 runs.json (pre-tokens schema)', async () => {
    // v1 record shape: lacks tokensPath and tokenSessionId. The picker should
    // still surface these runs — store.ts migrates v1 -> v2 in memory, so this
    // helper must use READABLE_VERSIONS rather than a strict equality check.
    const v1Run = {
      id: 'V1A',
      createdAt: '2026-05-01T10:00:00.000Z',
      projectPath: '/work/foo',
      savePath: '/work/foo/dist',
      componentCount: 2,
      tokenCount: 0,
      agent: 'claude',
      pushedTo: null,
      extractSessionId: 'extract-v1',
      generateSessionId: null,
    };
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 1, runs: [v1Run] }));
    const result = await shouldShowRunPicker({
      flags: NO_FLAGS,
      isTTY: true,
      runsJsonPath: '/fake/runs.json',
    });
    expect(result.shouldShow).toBe(true);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]?.id).toBe('V1A');
    // Migrated fields default to null so downstream consumers see RunRecord shape.
    expect(result.runs[0]?.tokensPath).toBeNull();
    expect(result.runs[0]?.tokenSessionId).toBeNull();
  });

  it('returns shouldShow=false for a future runs.json version this CLI cannot read', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ version: 999, runs: [makeRun('A')] }));
    const result = await shouldShowRunPicker({
      flags: NO_FLAGS,
      isTTY: true,
      runsJsonPath: '/fake/runs.json',
    });
    expect(result.shouldShow).toBe(false);
    expect(result.runs).toEqual([]);
  });

  it('returns shouldShow=false when stdin is not a TTY', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ version: RUNS_FILE_VERSION, runs: [makeRun('A')] }));
    const result = await shouldShowRunPicker({
      flags: NO_FLAGS,
      isTTY: false,
      runsJsonPath: '/fake/runs.json',
    });
    expect(result.shouldShow).toBe(false);
  });
});
