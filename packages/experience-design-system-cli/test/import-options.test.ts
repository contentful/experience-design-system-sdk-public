import { describe, expect, it } from 'vitest';
import { importOptionArgs, toImportOptions } from '../src/commands/import-options.js';

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

describe('importOptionArgs', () => {
  it('adds nothing when no flag was given', () => {
    expect(importOptionArgs({ prompt: [], cache: true })).toEqual([]);
  });

  it('forwards --agent as one flag and one value, including the agent:model form', () => {
    expect(importOptionArgs({ agent: 'codex:gpt-5', prompt: [], cache: true })).toEqual(['--agent', 'codex:gpt-5']);
  });

  it('repeats --prompt once per value, in order', () => {
    expect(importOptionArgs({ prompt: ['select=./a.md', 'token=literal text'], cache: true })).toEqual([
      '--prompt',
      'select=./a.md',
      '--prompt',
      'token=literal text',
    ]);
  });

  it('forwards --no-cache only when the cache is off', () => {
    expect(importOptionArgs({ prompt: [], cache: false })).toEqual(['--no-cache']);
  });

  it('puts the flags in a stable order', () => {
    expect(importOptionArgs({ agent: 'claude', prompt: ['select=x'], cache: false })).toEqual([
      '--agent',
      'claude',
      '--prompt',
      'select=x',
      '--no-cache',
    ]);
  });
});
