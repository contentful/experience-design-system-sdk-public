import { describe, expect, it, vi } from 'vitest';
import {
  buildCacheCheckArgs,
  checkGenerationCache,
  parseCacheComponents,
  type CacheCheckInput,
} from '../../../src/tui/import/steps/07-scope-gate/cache-check.js';

const input = (overrides: Partial<CacheCheckInput> = {}): CacheCheckInput => ({
  sessionId: 'sess-1',
  tokensPath: '/proj/.contentful/tokens.json',
  agent: 'claude',
  promptOverrides: [],
  existingEntitiesPath: null,
  noCache: false,
  ...overrides,
});

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' });

describe('buildCacheCheckArgs', () => {
  it('builds the generate arguments, then the two cache flags, in the order the wizard used', () => {
    expect(buildCacheCheckArgs(input())).toEqual([
      '__generate',
      'components',
      '--agent',
      'claude',
      '--session',
      'sess-1',
      '--tokens',
      '/proj/.contentful/tokens.json',
      '--cache-status',
      '--restore-cache',
    ]);
  });

  it('adds the model, prompts and existing entities between the tokens and the cache flags', () => {
    expect(
      buildCacheCheckArgs(
        input({
          agentModel: 'opus',
          promptOverrides: ['components=/p/a.md', 'select=/p/b.md'],
          existingEntitiesPath: '/proj/.existing.json',
        }),
      ),
    ).toEqual([
      '__generate',
      'components',
      '--agent',
      'claude',
      '--session',
      'sess-1',
      '--tokens',
      '/proj/.contentful/tokens.json',
      '--model',
      'opus',
      '--prompt',
      'components=/p/a.md',
      '--prompt',
      'select=/p/b.md',
      '--existing-entities-path',
      '/proj/.existing.json',
      '--cache-status',
      '--restore-cache',
    ]);
  });

  it('leaves out the tokens when there is no tokens file', () => {
    expect(buildCacheCheckArgs(input({ tokensPath: '' }))).not.toContain('--tokens');
  });

  it('passes --no-cache before the cache flags when asked to', () => {
    const args = buildCacheCheckArgs(input({ noCache: true }));
    expect(args).toContain('--no-cache');
    expect(args.indexOf('--no-cache')).toBeLessThan(args.indexOf('--cache-status'));
  });
});

describe('parseCacheComponents', () => {
  it('reads the names from the output line', () => {
    expect(parseCacheComponents('cache-status=miss\ncache-components=["Button","Card"]\n')).toEqual(['Button', 'Card']);
  });

  it('reads an empty list', () => {
    expect(parseCacheComponents('cache-components=[]\n')).toEqual([]);
  });

  it('is an empty list when the line is missing', () => {
    expect(parseCacheComponents('cache-status=hit\n')).toEqual([]);
  });

  it('is an empty list when the JSON is invalid', () => {
    expect(parseCacheComponents('cache-components=[Button\n')).toEqual([]);
  });

  it('is an empty list when the JSON is not a list', () => {
    expect(parseCacheComponents('cache-components={"a":1}\n')).toEqual([]);
  });

  it('keeps only the names that are strings', () => {
    expect(parseCacheComponents('cache-components=["Button",3,null,"Card"]\n')).toEqual(['Button', 'Card']);
  });
});

describe('checkGenerationCache', () => {
  it('returns the cached names the command reports', async () => {
    const run = vi.fn().mockResolvedValue(ok('cache-components=["Button"]\n'));
    expect(await checkGenerationCache(input(), run)).toEqual(['Button']);
    expect(run).toHaveBeenCalledWith(buildCacheCheckArgs(input()));
  });

  it('is an empty list when the command exits with an error, whatever it printed', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 2, stdout: 'cache-components=["Button"]\n', stderr: 'boom' });
    expect(await checkGenerationCache(input(), run)).toEqual([]);
  });

  it('is an empty list when the command prints no cache line', async () => {
    expect(await checkGenerationCache(input(), vi.fn().mockResolvedValue(ok('')))).toEqual([]);
  });

  it('does not throw when the command cannot be started', async () => {
    const run = vi.fn().mockRejectedValue(new Error('spawn failed'));
    await expect(checkGenerationCache(input(), run)).resolves.toEqual([]);
  });

  it('does not run the command at all with the cache off', async () => {
    const run = vi.fn();
    expect(await checkGenerationCache(input({ noCache: true }), run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
