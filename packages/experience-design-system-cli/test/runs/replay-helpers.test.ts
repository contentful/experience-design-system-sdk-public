import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetRun,
  mockFindAllBySavePath,
  mockUpdateRun,
  mockRunPrintComponents,
  mockRunPrintTokens,
  mockLaunchWizard,
} = vi.hoisted(() => ({
  mockGetRun: vi.fn(),
  mockFindAllBySavePath: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockRunPrintComponents: vi.fn(),
  mockRunPrintTokens: vi.fn(),
  mockLaunchWizard: vi.fn(),
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

vi.mock('../../src/runs/modify-launcher.js', () => ({
  launchModifyWizard: mockLaunchWizard,
}));

import { replayRun, modifyRun } from '../../src/runs/replay-helpers.js';
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
  mockLaunchWizard.mockResolvedValue(undefined);
});

describe('replayRun', () => {
  it('loads from pipeline.db using the recorded generateSessionId', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await replayRun({ runIdOrPath: '01HXYZABCDEFGHJKMNPQRSTVWXY' });
    expect(mockRunPrintComponents).toHaveBeenCalledWith({
      sessionId: 'g1',
      outPath: '/p/dist/components.json',
    });
  });

  it('falls back to extractSessionId when generateSessionId is null', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun({ generateSessionId: null }));
    await replayRun({ runIdOrPath: '01HXYZ' });
    expect(mockRunPrintComponents).toHaveBeenCalledWith({
      sessionId: 'e1',
      outPath: '/p/dist/components.json',
    });
  });

  it('writes to outDir when provided', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await replayRun({ runIdOrPath: '01HXYZ', outDir: '/elsewhere' });
    expect(mockRunPrintComponents).toHaveBeenCalledWith({
      sessionId: 'g1',
      outPath: '/elsewhere/components.json',
    });
  });

  it('updates the run record after successful replay', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await replayRun({ runIdOrPath: '01HXYZ' });
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
    await expect(replayRun({ runIdOrPath: '01HXYZ' })).rejects.toThrow(/no longer available/);
  });

  it('accepts an absolute filesystem path that matches a recorded savePath', async () => {
    mockFindAllBySavePath.mockResolvedValueOnce([sampleRun({ savePath: '/p/dist' })]);
    await replayRun({ runIdOrPath: '/p/dist' });
    expect(mockFindAllBySavePath).toHaveBeenCalledWith('/p/dist');
    expect(mockGetRun).not.toHaveBeenCalled();
    expect(mockRunPrintComponents).toHaveBeenCalledWith({
      sessionId: 'g1',
      outPath: '/p/dist/components.json',
    });
  });
});

describe('modifyRun', () => {
  it('loads the wizard pre-populated with the run session', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await modifyRun({ runIdOrPath: '01HXYZ' });
    expect(mockLaunchWizard).toHaveBeenCalledWith(
      expect.objectContaining({
        extractSessionId: 'e1',
        generateSessionId: 'g1',
        projectPath: '/p',
        entryStep: 'final-review',
      }),
    );
  });

  it('--overwrite reuses the existing savePath', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await modifyRun({ runIdOrPath: '01HXYZ', overwrite: true });
    expect(mockLaunchWizard).toHaveBeenCalledWith(
      expect.objectContaining({ savePath: '/p/dist', saveMode: 'overwrite' }),
    );
  });

  it('--save-as-new forces a new save path (no override)', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await modifyRun({ runIdOrPath: '01HXYZ', saveAsNew: true });
    expect(mockLaunchWizard).toHaveBeenCalledWith(
      expect.objectContaining({ saveMode: 'new' }),
    );
  });

  it('rejects --overwrite + --save-as-new at the helper level', async () => {
    await expect(
      modifyRun({ runIdOrPath: '01HXYZ', overwrite: true, saveAsNew: true }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it('accepts an absolute filesystem path that matches a recorded savePath', async () => {
    mockFindAllBySavePath.mockResolvedValueOnce([sampleRun({ savePath: '/p/dist' })]);
    await modifyRun({ runIdOrPath: '/p/dist' });
    expect(mockFindAllBySavePath).toHaveBeenCalledWith('/p/dist');
    expect(mockGetRun).not.toHaveBeenCalled();
    expect(mockLaunchWizard).toHaveBeenCalledWith(
      expect.objectContaining({ extractSessionId: 'e1', generateSessionId: 'g1' }),
    );
  });
});
