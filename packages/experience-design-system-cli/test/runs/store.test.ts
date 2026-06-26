import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockReadFile, mockWriteFile, mockMkdir, mockRename, mockChmod } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockRename: vi.fn(),
  mockChmod: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  rename: mockRename,
  chmod: mockChmod,
}));

import { appendRun, listRuns, getRun, RUNS_FILE_VERSION, type RunRecord } from '../../src/runs/store.js';

function makeRecord(overrides: Partial<RunRecord> = {}): Omit<RunRecord, 'id' | 'createdAt'> & Partial<Pick<RunRecord, 'id' | 'createdAt'>> {
  return {
    projectPath: '/work/foo',
    savePath: '/work/foo/dist',
    componentCount: 3,
    tokenCount: 12,
    tokensPath: '/work/foo/dist/tokens.json',
    tokenSessionId: 'tokens-abc',
    agent: 'claude',
    pushedTo: null,
    extractSessionId: 'extract-abc',
    generateSessionId: 'generate-abc',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);
  mockChmod.mockResolvedValue(undefined);
});

describe('appendRun', () => {
  it('creates runs.json if missing and writes a single record', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const rec = await appendRun(makeRecord());
    expect(rec.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);
    expect(rec.createdAt).toMatch(/T/);
    expect(mockWriteFile).toHaveBeenCalled();
    const lastCall = mockWriteFile.mock.calls[0]!;
    const body = lastCall[1];
    const opts = lastCall[2];
    const parsed = JSON.parse(String(body));
    expect(parsed.version).toBe(RUNS_FILE_VERSION);
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0].savePath).toBe('/work/foo/dist');
    expect(opts).toMatchObject({ mode: 0o600 });
  });

  it('prepends subsequent records (newest first)', async () => {
    const earlier: RunRecord = {
      id: '01HXYZAAAAAAAAAAAAAAAAAAA0',
      createdAt: '2026-06-23T00:00:00.000Z',
      projectPath: '/work/foo',
      savePath: '/work/foo/dist',
      componentCount: 1,
      tokenCount: 1,
      tokensPath: null,
      tokenSessionId: null,
      agent: 'claude',
      pushedTo: null,
      extractSessionId: 'e0',
      generateSessionId: 'g0',
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: RUNS_FILE_VERSION, runs: [earlier] }));
    await appendRun(makeRecord({ savePath: '/work/foo/dist2' }));
    const body = mockWriteFile.mock.calls[0]![1];
    const parsed = JSON.parse(String(body));
    expect(parsed.runs).toHaveLength(2);
    expect(parsed.runs[0].savePath).toBe('/work/foo/dist2');
    expect(parsed.runs[1].id).toBe(earlier.id);
  });

  it('caps the file at 200 records and drops oldest', async () => {
    const many: RunRecord[] = Array.from({ length: 200 }, (_, i) => ({
      id: `R${String(i).padStart(25, '0')}`,
      createdAt: new Date(2025, 0, 1 + i).toISOString(),
      projectPath: '/work/foo',
      savePath: '/work/foo/dist',
      componentCount: 1,
      tokenCount: 1,
      tokensPath: null,
      tokenSessionId: null,
      agent: 'claude',
      pushedTo: null,
      extractSessionId: 'e',
      generateSessionId: 'g',
    }));
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: RUNS_FILE_VERSION, runs: many }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await appendRun(makeRecord({ savePath: '/work/foo/dist-new' }));
    const body = mockWriteFile.mock.calls[0]![1];
    const parsed = JSON.parse(String(body));
    expect(parsed.runs).toHaveLength(200);
    expect(parsed.runs[0].savePath).toBe('/work/foo/dist-new');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses to read a file with mismatched version', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: 999, runs: [] }));
    await expect(appendRun(makeRecord())).rejects.toThrow(/version/);
  });

  it('records the new tokensPath and tokenSessionId fields', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const rec = await appendRun(
      makeRecord({ tokensPath: '/work/foo/dist/tokens.json', tokenSessionId: 'tokens-xyz', tokenCount: 7 }),
    );
    expect(rec.tokensPath).toBe('/work/foo/dist/tokens.json');
    expect(rec.tokenSessionId).toBe('tokens-xyz');
    expect(rec.tokenCount).toBe(7);
    const body = mockWriteFile.mock.calls[0]![1];
    const parsed = JSON.parse(String(body));
    expect(parsed.version).toBe(3);
    expect(parsed.runs[0].tokensPath).toBe('/work/foo/dist/tokens.json');
    expect(parsed.runs[0].tokenSessionId).toBe('tokens-xyz');
  });
});

describe('runs.json v1 -> v2 migration', () => {
  it('loads v1 files and treats new fields as null without erroring', async () => {
    const v1Record = {
      id: 'R1',
      createdAt: '2026-06-20T00:00:00.000Z',
      projectPath: '/work/foo',
      savePath: '/work/foo/dist',
      componentCount: 2,
      tokenCount: 0,
      agent: 'claude',
      pushedTo: null,
      extractSessionId: 'e',
      generateSessionId: null,
      // intentionally no tokensPath / tokenSessionId — v1 shape
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: 1, runs: [v1Record] }));
    const got = await getRun('R1');
    expect(got.tokensPath).toBeNull();
    expect(got.tokenSessionId).toBeNull();
    expect(got.componentCount).toBe(2);
  });

  it('persists future writes as v2 even when the on-disk file is v1', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        version: 1,
        runs: [
          {
            id: 'R1',
            createdAt: '2026-06-20T00:00:00.000Z',
            projectPath: '/work/foo',
            savePath: '/work/foo/dist',
            componentCount: 1,
            tokenCount: 0,
            agent: 'claude',
            pushedTo: null,
            extractSessionId: 'e',
            generateSessionId: null,
          },
        ],
      }),
    );
    await appendRun(makeRecord({ savePath: '/work/foo/dist2' }));
    const body = mockWriteFile.mock.calls[0]![1];
    const parsed = JSON.parse(String(body));
    expect(parsed.version).toBe(3);
    // Old record carried forward with the new fields populated as null.
    expect(parsed.runs.find((r: { id: string }) => r.id === 'R1').tokensPath).toBeNull();
    expect(parsed.runs.find((r: { id: string }) => r.id === 'R1').tokenSessionId).toBeNull();
  });
});

describe('listRuns', () => {
  const sample: RunRecord[] = [
    { id: 'r5', createdAt: '2026-06-25', projectPath: '/a', savePath: '/a/x', componentCount: 1, tokenCount: 1, tokensPath: null, tokenSessionId: null, agent: 'claude', pushedTo: null, extractSessionId: 'e', generateSessionId: null },
    { id: 'r4', createdAt: '2026-06-24', projectPath: '/b', savePath: '/b/x', componentCount: 1, tokenCount: 1, tokensPath: null, tokenSessionId: null, agent: 'claude', pushedTo: null, extractSessionId: 'e', generateSessionId: null },
    { id: 'r3', createdAt: '2026-06-23', projectPath: '/a', savePath: '/a/y', componentCount: 1, tokenCount: 1, tokensPath: null, tokenSessionId: null, agent: 'claude', pushedTo: null, extractSessionId: 'e', generateSessionId: null },
    { id: 'r2', createdAt: '2026-06-22', projectPath: '/a', savePath: '/a/z', componentCount: 1, tokenCount: 1, tokensPath: null, tokenSessionId: null, agent: 'claude', pushedTo: null, extractSessionId: 'e', generateSessionId: null },
    { id: 'r1', createdAt: '2026-06-21', projectPath: '/b', savePath: '/b/y', componentCount: 1, tokenCount: 1, tokensPath: null, tokenSessionId: null, agent: 'claude', pushedTo: null, extractSessionId: 'e', generateSessionId: null },
  ];

  it('returns the newest N entries with --limit', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: RUNS_FILE_VERSION, runs: sample }));
    const result = await listRuns({ limit: 3 });
    expect(result.map((r) => r.id)).toEqual(['r5', 'r4', 'r3']);
  });

  it('filters by projectPath', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: RUNS_FILE_VERSION, runs: sample }));
    const result = await listRuns({ projectPath: '/a' });
    expect(result.map((r) => r.id)).toEqual(['r5', 'r3', 'r2']);
  });

  it('returns [] when the file is missing', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const result = await listRuns();
    expect(result).toEqual([]);
  });
});

describe('runs.json v2 -> v3 migration', () => {
  it('loads v2 records and treats fingerprint fields as null', async () => {
    const v2Record = {
      id: 'R2',
      createdAt: '2026-06-22T00:00:00.000Z',
      projectPath: '/work/foo',
      savePath: '/work/foo/dist',
      componentCount: 3,
      tokenCount: 0,
      tokensPath: null,
      tokenSessionId: null,
      agent: 'claude',
      pushedTo: null,
      extractSessionId: 'e',
      generateSessionId: null,
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: 2, runs: [v2Record] }));
    const got = await getRun('R2');
    expect(got.sourceFingerprint ?? null).toBeNull();
    expect(got.savedFingerprint ?? null).toBeNull();
  });

  it('writes v3 records with the new fingerprint fields populated', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const rec = await appendRun(
      makeRecord({
        sourceFingerprint: {
          files: { '/p/Button.tsx': { mtime: '2026-06-25T00:00:00.000Z', componentName: 'Button' } },
          rawTokensPath: null,
          rawTokensMtime: null,
          rawTokensContentHash: null,
        },
        savedFingerprint: {
          componentsJsonHash: 'a'.repeat(64),
          tokensJsonHash: null,
        },
      }),
    );
    expect(rec.sourceFingerprint?.files['/p/Button.tsx']?.componentName).toBe('Button');
    const body = mockWriteFile.mock.calls[0]![1];
    const parsed = JSON.parse(String(body));
    expect(parsed.version).toBe(3);
    expect(parsed.runs[0].sourceFingerprint.files['/p/Button.tsx'].componentName).toBe('Button');
    expect(parsed.runs[0].savedFingerprint.componentsJsonHash).toBe('a'.repeat(64));
  });

  it('normalizes missing fingerprint fields to null on write', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await appendRun(makeRecord());
    const body = mockWriteFile.mock.calls[0]![1];
    const parsed = JSON.parse(String(body));
    expect(parsed.runs[0].sourceFingerprint).toBeNull();
    expect(parsed.runs[0].savedFingerprint).toBeNull();
  });
});

describe('getRun', () => {
  it('returns the matching record', async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        version: RUNS_FILE_VERSION,
        runs: [
          { id: 'abc', createdAt: '2026-06-25', projectPath: '/a', savePath: '/a/x', componentCount: 0, tokenCount: 0, tokensPath: null, tokenSessionId: null, agent: 'claude', pushedTo: null, extractSessionId: 'e', generateSessionId: null },
        ],
      }),
    );
    const r = await getRun('abc');
    expect(r.id).toBe('abc');
  });

  it('throws when the record is missing', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ version: RUNS_FILE_VERSION, runs: [] }));
    await expect(getRun('nope')).rejects.toThrow(/not found/);
  });
});
