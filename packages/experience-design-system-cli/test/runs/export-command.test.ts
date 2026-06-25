import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetRun,
  mockFindAllBySavePath,
  mockUpdateRun,
  mockRunPrintComponents,
  mockRunPrintTokens,
} = vi.hoisted(() => ({
  mockGetRun: vi.fn(),
  mockFindAllBySavePath: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockRunPrintComponents: vi.fn(),
  mockRunPrintTokens: vi.fn(),
}));

vi.mock('../../src/runs/store.js', () => ({
  getRun: mockGetRun,
  findAllRunsBySavePath: mockFindAllBySavePath,
  updateRun: mockUpdateRun,
}));

vi.mock('../../src/runs/export-helpers.js', () => ({
  printComponentsFromSession: mockRunPrintComponents,
  printTokensFromSession: mockRunPrintTokens,
}));

import { runExportCommand } from '../../src/runs/export-command.js';
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
  mockRunPrintComponents.mockResolvedValue({ ok: true });
  mockRunPrintTokens.mockResolvedValue({ ok: true });
  mockUpdateRun.mockResolvedValue(undefined);
});

describe('runExportCommand', () => {
  it('loads from pipeline.db using the recorded generateSessionId', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await runExportCommand({ runIdOrPath: '01HXYZABCDEFGHJKMNPQRSTVWXY' });
    expect(mockRunPrintComponents).toHaveBeenCalledWith({
      sessionId: 'g1',
      outPath: '/p/dist/components.json',
    });
  });

  it('falls back to extractSessionId when generateSessionId is null', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun({ generateSessionId: null }));
    await runExportCommand({ runIdOrPath: '01HXYZ' });
    expect(mockRunPrintComponents).toHaveBeenCalledWith({
      sessionId: 'e1',
      outPath: '/p/dist/components.json',
    });
  });

  it('writes to --out-dir when provided', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await runExportCommand({ runIdOrPath: '01HXYZ', outDir: '/elsewhere' });
    expect(mockRunPrintComponents).toHaveBeenCalledWith({
      sessionId: 'g1',
      outPath: '/elsewhere/components.json',
    });
  });

  it('updates the run record after successful export', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await runExportCommand({ runIdOrPath: '01HXYZ' });
    expect(mockUpdateRun).toHaveBeenCalledWith(
      '01HXYZABCDEFGHJKMNPQRSTVWXY',
      expect.objectContaining({ savePath: '/p/dist' }),
    );
  });

  it('errors when the session is no longer in pipeline.db', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    mockRunPrintComponents.mockResolvedValueOnce({
      ok: false,
      error: "no generated components in session 'g1'",
    });
    await expect(runExportCommand({ runIdOrPath: '01HXYZ' })).rejects.toThrow(/no longer available/);
  });

  it('accepts an absolute filesystem path that matches a recorded savePath', async () => {
    mockFindAllBySavePath.mockResolvedValueOnce([sampleRun({ savePath: '/p/dist' })]);
    await runExportCommand({ runIdOrPath: '/p/dist' });
    expect(mockFindAllBySavePath).toHaveBeenCalledWith('/p/dist');
    expect(mockGetRun).not.toHaveBeenCalled();
    expect(mockRunPrintComponents).toHaveBeenCalledWith({
      sessionId: 'g1',
      outPath: '/p/dist/components.json',
    });
  });
});
