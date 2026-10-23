import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkGenerationCache, type CacheCheckInput } from '../../../src/tui/import/steps/07-scope-gate/cache-check.js';
import * as bp from '@contentful/experience-design-system-backend-pipeline';

const input = (overrides: Partial<CacheCheckInput> = {}): CacheCheckInput => ({
  sessionId: 'sess-1',
  tokensPath: '/proj/.contentful/tokens.json',
  agent: 'claude',
  promptOverrides: [],
  existingEntitiesPath: null,
  noCache: false,
  ...overrides,
});

beforeEach(() => vi.restoreAllMocks());

describe('checkGenerationCache', () => {
  it('returns the cached names the orchestrator reports', async () => {
    const spy = vi.spyOn(bp, 'checkGenerateComponentsCache').mockResolvedValue({
      sessionId: 'sess-1',
      cachedComponentNames: ['Button'],
      fullyCached: false,
      cacheDisabled: false,
    });
    expect(await checkGenerationCache(input())).toEqual(['Button']);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', restoreCache: true, noCache: false }),
    );
  });

  it('is an empty list when the orchestrator rejects', async () => {
    vi.spyOn(bp, 'checkGenerateComponentsCache').mockRejectedValue(new Error('boom'));
    expect(await checkGenerationCache(input())).toEqual([]);
  });

  it('does not call the orchestrator with the cache off', async () => {
    const spy = vi.spyOn(bp, 'checkGenerateComponentsCache');
    expect(await checkGenerationCache(input({ noCache: true }))).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
