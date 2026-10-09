import { describe, expect, it } from 'vitest';
import { resolveAgent } from '../helpers/resolution/resolve-agent.js';
import { resolveModel } from '../helpers/resolution/resolve-model.js';

describe('resolveAgent', () => {
  it('prefers the flag value when provided', () => {
    expect(resolveAgent('codex', 'claude')).toBe('codex');
  });
  it('falls back to the stored value when no flag', () => {
    expect(resolveAgent(undefined, 'claude')).toBe('claude');
  });
  it('falls back to the built-in default when neither is provided', () => {
    expect(resolveAgent(undefined, undefined)).toBe('claude');
  });
});

describe('resolveModel', () => {
  it('prefers the flag value', () => {
    expect(resolveModel('haiku', 'opus')).toBe('haiku');
  });
  it('returns undefined when neither is provided', () => {
    expect(resolveModel(undefined, undefined)).toBeUndefined();
  });
});
