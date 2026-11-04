import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  loadDTCGTokens: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ mkdir: mocks.mkdir, writeFile: mocks.writeFile }));
vi.mock('../../src/persistence/src/session/repositories/db.js', () => ({ loadDTCGTokens: mocks.loadDTCGTokens }));

import { writeTokensFile } from '../../src/orchestrators/run-generate-tokens-session/helpers/write-tokens-file.js';

describe('token file cancellation boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadDTCGTokens.mockReturnValue({
      groups: [],
      tokens: [{ path: 'color.brand', $type: 'color', $value: '#123' }],
    });
  });

  it('does not begin a file operation for a pre-aborted request', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(writeTokensFile({} as never, 'session', '/out', vi.fn(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(mocks.loadDTCGTokens).not.toHaveBeenCalled();
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('does not start file output after cancellation during directory creation', async () => {
    const controller = new AbortController();
    mocks.mkdir.mockImplementationOnce(async () => {
      controller.abort();
    });

    await expect(writeTokensFile({} as never, 'session', '/out', vi.fn(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(mocks.mkdir).toHaveBeenCalledOnce();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('writes the token file for a live request', async () => {
    await expect(writeTokensFile({} as never, 'session', '/out', vi.fn())).resolves.toEqual({
      tokensPath: '/out/tokens.json',
      tokenCount: 1,
    });
    expect(mocks.mkdir).toHaveBeenCalledWith('/out', { recursive: true });
    expect(mocks.writeFile).toHaveBeenCalledOnce();
  });
});
