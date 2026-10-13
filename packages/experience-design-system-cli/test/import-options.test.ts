import { describe, expect, it } from 'vitest';
import { toImportOptions } from '../src/commands/import-options.js';

describe('toImportOptions', () => {
  it('defaults to no agent, no prompts and the cache on', () => {
    expect(toImportOptions({})).toEqual({ prompt: [], cache: true });
  });

  it('reads --no-cache, which Commander reports as cache: false', () => {
    expect(toImportOptions({ cache: false }).cache).toBe(false);
    expect(toImportOptions({ cache: true }).cache).toBe(true);
  });

  it('keeps the agent and every repeated --prompt in order', () => {
    expect(toImportOptions({ agent: 'codex', prompt: ['select=./a.md', 'token=./b.md'] })).toEqual({
      agent: 'codex',
      prompt: ['select=./a.md', 'token=./b.md'],
      cache: true,
    });
  });

  it('treats an empty agent as not set', () => {
    expect(toImportOptions({ agent: '' })).toEqual({ prompt: [], cache: true });
  });
});
