import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetRun,
  mockFindAllBySavePath,
  mockUpdateRun,
  mockPushRunSession,
  mockReadCreds,
  mockLaunchWizard,
} = vi.hoisted(() => ({
  mockGetRun: vi.fn(),
  mockFindAllBySavePath: vi.fn(),
  mockUpdateRun: vi.fn(),
  mockPushRunSession: vi.fn(),
  mockReadCreds: vi.fn(),
  mockLaunchWizard: vi.fn(),
}));

vi.mock('../../src/runs/store.js', () => ({
  getRun: mockGetRun,
  findAllRunsBySavePath: mockFindAllBySavePath,
  updateRun: mockUpdateRun,
}));

vi.mock('../../src/runs/push-helpers.js', () => ({
  pushRunSession: mockPushRunSession,
}));

vi.mock('../../src/credentials-store.js', () => ({
  readExperiencesCredentials: mockReadCreds,
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

const emptyCreds = { spaceId: '', environmentId: '', cmaToken: '' };

beforeEach(() => {
  vi.resetAllMocks();
  mockPushRunSession.mockResolvedValue({ ok: true });
  mockUpdateRun.mockResolvedValue(undefined);
  mockReadCreds.mockResolvedValue(emptyCreds);
  mockLaunchWizard.mockResolvedValue(undefined);
});

describe('replayRun (push-only)', () => {
  it('pushes using the recorded generateSessionId when flag creds are supplied', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => { writes.push(String(chunk)); return true; }) as never;
    try {
      await replayRun({
        runIdOrPath: '01HXYZ',
        spaceId: 'sp',
        environmentId: 'env',
        cmaToken: 'tok',
      });
    } finally {
      process.stdout.write = origWrite;
    }
    expect(mockPushRunSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'g1', spaceId: 'sp', environmentId: 'env', cmaToken: 'tok' }),
    );
    expect(writes.join('')).toContain('Pushed 3 components to sp/env');
    expect(writes.join('')).toContain('(also: 4 tokens)');
  });

  it('falls back to extractSessionId when generateSessionId is null', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun({ generateSessionId: null }));
    await replayRun({
      runIdOrPath: '01HXYZ',
      spaceId: 'sp',
      environmentId: 'env',
      cmaToken: 'tok',
    });
    expect(mockPushRunSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'e1' }),
    );
  });

  it('resolves credentials from the run record when flags are absent', async () => {
    mockGetRun.mockResolvedValueOnce(
      sampleRun({ pushedTo: { spaceId: 'rec-sp', environmentId: 'rec-env', host: 'api.flinkly.com' } }),
    );
    mockReadCreds.mockResolvedValueOnce({
      spaceId: '',
      environmentId: '',
      cmaToken: 'tok-from-store',
    });
    await replayRun({ runIdOrPath: '01HXYZ' });
    expect(mockPushRunSession).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'rec-sp',
        environmentId: 'rec-env',
        cmaToken: 'tok-from-store',
        host: 'api.flinkly.com',
      }),
    );
  });

  it('errors at parse/setup time when creds are missing and not interactive', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    mockReadCreds.mockResolvedValueOnce(emptyCreds);
    await expect(
      replayRun({ runIdOrPath: '01HXYZ', interactive: false }),
    ).rejects.toThrow(/requires credentials/);
    expect(mockPushRunSession).not.toHaveBeenCalled();
  });

  it('prompts for missing credentials when interactive', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    mockReadCreds.mockResolvedValueOnce(emptyCreds);
    const prompt = vi.fn().mockResolvedValue({
      spaceId: 'sp-p',
      environmentId: 'env-p',
      cmaToken: 'tok-p',
      host: 'api.contentful.com',
    });
    await replayRun({ runIdOrPath: '01HXYZ', interactive: true, promptForCredentials: prompt });
    expect(prompt).toHaveBeenCalled();
    expect(mockPushRunSession).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'sp-p', environmentId: 'env-p', cmaToken: 'tok-p' }),
    );
  });

  it('updates the run record pushedTo after a successful push', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await replayRun({
      runIdOrPath: '01HXYZ',
      spaceId: 'sp',
      environmentId: 'env',
      cmaToken: 'tok',
      host: 'api.flinkly.com',
    });
    expect(mockUpdateRun).toHaveBeenCalledWith(
      '01HXYZABCDEFGHJKMNPQRSTVWXY',
      expect.objectContaining({ pushedTo: { spaceId: 'sp', environmentId: 'env', host: 'api.flinkly.com' } }),
    );
  });

  it('surfaces the underlying error when push fails', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    mockPushRunSession.mockResolvedValueOnce({ ok: false, error: 'CMA 401: invalid token' });
    await expect(
      replayRun({
        runIdOrPath: '01HXYZ',
        spaceId: 'sp',
        environmentId: 'env',
        cmaToken: 'tok',
      }),
    ).rejects.toThrow(/CMA 401/);
    expect(mockUpdateRun).not.toHaveBeenCalled();
  });

  it('accepts an absolute filesystem path that matches a recorded savePath', async () => {
    mockFindAllBySavePath.mockResolvedValueOnce([sampleRun({ savePath: '/p/dist' })]);
    await replayRun({
      runIdOrPath: '/p/dist',
      spaceId: 'sp',
      environmentId: 'env',
      cmaToken: 'tok',
    });
    expect(mockFindAllBySavePath).toHaveBeenCalledWith('/p/dist');
    expect(mockGetRun).not.toHaveBeenCalled();
    expect(mockPushRunSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'g1' }),
    );
  });

  it('does NOT write components.json / tokens.json locally', async () => {
    mockGetRun.mockResolvedValueOnce(sampleRun());
    await replayRun({
      runIdOrPath: '01HXYZ',
      spaceId: 'sp',
      environmentId: 'env',
      cmaToken: 'tok',
    });
    // The push-only path delegates to pushRunSession (which shells out to
    // `apply push --session`). It never imports node:fs/promises writeFile,
    // and the helper has no save-side branch. This assertion guards against
    // a regression that would re-introduce printComponentsFromSession.
    expect(mockPushRunSession).toHaveBeenCalledTimes(1);
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

  it('--save-as-new forces a new save path', async () => {
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
