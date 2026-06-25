import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetRun, mockFindAllBySavePath, mockLaunchWizard } = vi.hoisted(() => ({
  mockGetRun: vi.fn(),
  mockFindAllBySavePath: vi.fn(),
  mockLaunchWizard: vi.fn(),
}));

vi.mock('../../src/runs/store.js', () => ({
  getRun: mockGetRun,
  findAllRunsBySavePath: mockFindAllBySavePath,
}));

vi.mock('../../src/runs/modify-launcher.js', () => ({
  launchModifyWizard: mockLaunchWizard,
}));

import { runModifyCommand } from '../../src/runs/modify-command.js';
import type { RunRecord } from '../../src/runs/store.js';

const sampleRun = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: '01HXYZ',
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
  mockLaunchWizard.mockResolvedValue(undefined);
});

describe('runModifyCommand', () => {
  it('loads the wizard pre-populated with the run session', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await runModifyCommand({ runIdOrPath: '01HXYZ' });
    expect(mockLaunchWizard).toHaveBeenCalledWith(
      expect.objectContaining({
        extractSessionId: 'e1',
        generateSessionId: 'g1',
        projectPath: '/p',
        entryStep: 'final-review',
      }),
    );
  });

  it('defaults the entry point to final-review', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await runModifyCommand({ runIdOrPath: '01HXYZ' });
    expect(mockLaunchWizard.mock.calls[0]![0]!.entryStep).toBe('final-review');
  });

  it('--overwrite reuses the existing savePath', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await runModifyCommand({ runIdOrPath: '01HXYZ', overwrite: true });
    expect(mockLaunchWizard).toHaveBeenCalledWith(
      expect.objectContaining({ savePath: '/p/dist', saveMode: 'overwrite' }),
    );
  });

  it('--save-as-new forces a new save path (no override)', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await runModifyCommand({ runIdOrPath: '01HXYZ', saveAsNew: true });
    expect(mockLaunchWizard).toHaveBeenCalledWith(
      expect.objectContaining({ saveMode: 'new' }),
    );
  });

  it('accepts an absolute filesystem path that matches a recorded savePath', async () => {
    mockFindAllBySavePath.mockResolvedValueOnce([sampleRun({ savePath: '/p/dist' })]);
    await runModifyCommand({ runIdOrPath: '/p/dist' });
    expect(mockFindAllBySavePath).toHaveBeenCalledWith('/p/dist');
    expect(mockGetRun).not.toHaveBeenCalled();
    expect(mockLaunchWizard).toHaveBeenCalledWith(
      expect.objectContaining({ extractSessionId: 'e1', generateSessionId: 'g1' }),
    );
  });
});
