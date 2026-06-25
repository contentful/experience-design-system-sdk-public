import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetRun, mockUpdateRun, mockRunPrintComponents, mockRunPrintTokens } = vi.hoisted(() => ({
  mockGetRun: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockRunPrintComponents: vi.fn(),
  mockRunPrintTokens: vi.fn(),
}));

vi.mock('../../src/runs/store.js', () => ({
  getRun: mockGetRun,
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
    await runExportCommand({ runId: '01HXYZABCDEFGHJKMNPQRSTVWXY' });
    expect(mockRunPrintComponents).toHaveBeenCalledWith({
      sessionId: 'g1',
      outPath: '/p/dist/components.json',
    });
  });

  it('falls back to extractSessionId when generateSessionId is null', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun({ generateSessionId: null }));
    await runExportCommand({ runId: '01HXYZ' });
    expect(mockRunPrintComponents).toHaveBeenCalledWith({
      sessionId: 'e1',
      outPath: '/p/dist/components.json',
    });
  });

  it('writes to --out-dir when provided', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await runExportCommand({ runId: '01HXYZ', outDir: '/elsewhere' });
    expect(mockRunPrintComponents).toHaveBeenCalledWith({
      sessionId: 'g1',
      outPath: '/elsewhere/components.json',
    });
  });

  it('updates the run record after successful export', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await runExportCommand({ runId: '01HXYZ' });
    expect(mockUpdateRun).toHaveBeenCalledWith(
      '01HXYZ',
      expect.objectContaining({ savePath: '/p/dist' }),
    );
  });

  it('errors when the session is no longer in pipeline.db, surfacing the underlying reason', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    mockRunPrintComponents.mockResolvedValueOnce({
      ok: false,
      error: "no generated components in session 'g1'",
    });
    await expect(runExportCommand({ runId: '01HXYZ' })).rejects.toThrow(
      /Failed to re-emit components for run 01HXYZ: no generated components in session 'g1'/,
    );
  });

  it('does not blame a missing pipeline.db session when the underlying error is unrelated', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    mockRunPrintComponents.mockResolvedValueOnce({
      ok: false,
      error:
        "Cannot find module '/repo/packages/experience-design-system-cli/dist/bin/cli.js'",
    });
    let caught: unknown;
    try {
      await runExportCommand({ runId: '01HXYZ' });
    } catch (e) {
      caught = e;
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toMatch(/Failed to re-emit components for run 01HXYZ: Cannot find module/);
    expect(message).not.toMatch(/no longer available in pipeline\.db/);
  });
});
