import { describe, expect, it } from 'vitest';
import { toImportOptions } from '../src/commands/import-options.js';

describe('toImportOptions', () => {
  it('defaults to no agent and no prompts', () => {
    expect(toImportOptions({})).toEqual({ prompt: [] });
  });

  it('keeps the agent and every repeated --prompt in order', () => {
    expect(toImportOptions({ agent: 'codex', prompt: ['select=./a.md', 'token=./b.md'] })).toEqual({
      agent: 'codex',
      prompt: ['select=./a.md', 'token=./b.md'],
    });
  });

  it('treats an empty agent as not set', () => {
    expect(toImportOptions({ agent: '' })).toEqual({ prompt: [] });
  });
});
