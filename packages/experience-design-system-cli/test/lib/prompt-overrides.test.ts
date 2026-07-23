import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parsePromptOverrides,
  resolvePromptOverride,
  looksLikePath,
  type PromptOverride,
} from '../../src/lib/prompt-overrides.js';

describe('looksLikePath (string-shape only, no fs)', () => {
  it('treats slash-containing values as paths', () => {
    expect(looksLikePath('./prompts/x.md')).toBe(true);
    expect(looksLikePath('/abs/prompt.txt')).toBe(true);
    expect(looksLikePath('a/b/c')).toBe(true);
    expect(looksLikePath('~/p.md')).toBe(true);
  });

  it('treats known prompt-file extensions as paths', () => {
    expect(looksLikePath('prompt.md')).toBe(true);
    expect(looksLikePath('notes.txt')).toBe(true);
    expect(looksLikePath('x.prompt')).toBe(true);
  });

  it('treats bare instruction text as literal', () => {
    expect(looksLikePath('Resolve parent-child composition from the files.')).toBe(false);
    expect(looksLikePath('be concise')).toBe(false);
  });
});

describe('parsePromptOverrides', () => {
  it('parses stage=value into a map', () => {
    const { overrides, errors } = parsePromptOverrides(['composition=be concise']);
    expect(errors).toHaveLength(0);
    const o = overrides.get('composition') as PromptOverride;
    expect(o).toEqual({ kind: 'text', value: 'be concise' });
  });

  it('detects a path-shaped value', () => {
    const { overrides } = parsePromptOverrides(['composition=./my-prompt.md']);
    expect(overrides.get('composition')).toEqual({ kind: 'path', value: './my-prompt.md' });
  });

  it('keeps = characters in the value (only splits on the first =)', () => {
    const { overrides } = parsePromptOverrides(['composition=use a=b format']);
    expect(overrides.get('composition')).toEqual({ kind: 'text', value: 'use a=b format' });
  });

  it('supports multiple stages (repeatable flag)', () => {
    const { overrides } = parsePromptOverrides(['composition=x', 'select=./s.md']);
    expect(overrides.get('composition')).toEqual({ kind: 'text', value: 'x' });
    expect(overrides.get('select')).toEqual({ kind: 'path', value: './s.md' });
  });

  it('errors on a missing = separator', () => {
    const { errors } = parsePromptOverrides(['composition']);
    expect(errors.join(' ')).toMatch(/stage=value/i);
  });

  it('errors on an empty stage', () => {
    const { errors } = parsePromptOverrides(['=text']);
    expect(errors.join(' ')).toMatch(/stage/i);
  });

  it('errors on an empty value', () => {
    const { errors } = parsePromptOverrides(['composition=']);
    expect(errors.join(' ')).toMatch(/value/i);
  });

  it('last write wins for a repeated stage', () => {
    const { overrides } = parsePromptOverrides(['composition=first', 'composition=second']);
    expect(overrides.get('composition')).toEqual({ kind: 'text', value: 'second' });
  });
});

describe('resolvePromptOverride', () => {
  it('returns literal text verbatim', async () => {
    expect(await resolvePromptOverride({ kind: 'text', value: 'be concise' })).toBe('be concise');
  });

  it('reads a path override from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prompt-'));
    const p = join(dir, 'prompt.md');
    await writeFile(p, 'CUSTOM INSTRUCTION\n');
    expect(await resolvePromptOverride({ kind: 'path', value: p })).toBe('CUSTOM INSTRUCTION\n');
  });

  it('throws a clear error for an unreadable path', async () => {
    await expect(resolvePromptOverride({ kind: 'path', value: '/no/such/prompt.md' })).rejects.toThrow(
      /could not read prompt file/i,
    );
  });
});
