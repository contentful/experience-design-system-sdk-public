import { afterEach, describe, expect, it, vi } from 'vitest';
import * as backend from '@contentful/experience-design-system-backend-pipeline';
import { prepareMapTokens } from '../../../src/tui/import/steps/08-generation/map-tokens.js';

describe('cancellation remainder — map preparation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not store the token universe when cancellation arrives during the token-file read', async () => {
    const controller = new AbortController();
    const db = { close: vi.fn() };
    type Tokens = Awaited<ReturnType<typeof backend.readTokensFromPath>>;
    let finishRead!: (tokens: Tokens) => void;
    const read = vi
      .spyOn(backend, 'readTokensFromPath')
      .mockImplementation(() => new Promise<Tokens>((resolve) => (finishRead = resolve)));
    const open = vi
      .spyOn(backend, 'openPipelineDb')
      .mockReturnValue(db as unknown as ReturnType<typeof backend.openPipelineDb>);
    const store = vi.spyOn(backend, 'storeDTCGTokens').mockImplementation(() => undefined);
    vi.spyOn(backend, 'loadCDFComponents').mockReturnValue([]);
    vi.spyOn(backend, 'loadDTCGTokens').mockReturnValue({ groups: [], tokens: [] });

    const request = prepareMapTokens(
      { tokenSessionId: null, tokensPath: '/tokens.json', signal: controller.signal },
      'session-1',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    finishRead([]);

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(open).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    expect(store).not.toHaveBeenCalled();
    expect(db.close).toHaveBeenCalledOnce();
  });
});
