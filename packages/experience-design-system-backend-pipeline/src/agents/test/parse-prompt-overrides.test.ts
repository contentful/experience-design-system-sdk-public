import { describe, expect, it } from 'vitest';
import { parsePromptOverrides } from '../helpers/parse-prompt-overrides.js';
import { looksLikePath } from '../helpers/looks-like-path.js';

describe('looksLikePath', () => {
  it('recognizes path separators + ~ + prompt file extensions', () => {
    expect(looksLikePath('./x.md')).toBe(true);
    expect(looksLikePath('C:\\x.txt')).toBe(true);
    expect(looksLikePath('~/x.prompt')).toBe(true);
    expect(looksLikePath('plain-text')).toBe(false);
  });
});

describe('parsePromptOverrides', () => {
  it('parses stage=value pairs and classifies by shape', () => {
    const result = parsePromptOverrides(['composition=./comp.md', 'select=raw prompt text']);
    expect(result.errors).toEqual([]);
    expect(result.overrides.get('composition')).toEqual({ kind: 'path', value: './comp.md' });
    expect(result.overrides.get('select')).toEqual({ kind: 'text', value: 'raw prompt text' });
  });
  it('reports malformed inputs', () => {
    const result = parsePromptOverrides(['no-equals', '=value', 'stage=']);
    expect(result.errors.length).toBe(3);
    expect(result.overrides.size).toBe(0);
  });
  it('splits on the FIRST = so values may contain =', () => {
    const result = parsePromptOverrides(['stage=key=val']);
    expect(result.overrides.get('stage')).toEqual({ kind: 'text', value: 'key=val' });
  });
});
