import { describe, it, expect } from 'vitest';
import { computeTokenInputHash } from '../../../../src/session/core/tokens/input-hash.js';

describe('computeTokenInputHash', () => {
  it('trims surrounding whitespace before hashing', () => {
    expect(computeTokenInputHash('{"a":1}')).toBe(computeTokenInputHash('  {"a":1}  '));
  });

  it('returns a 64-char sha256 hex string', () => {
    expect(computeTokenInputHash('{}')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes different content', () => {
    expect(computeTokenInputHash('{"a":1}')).not.toBe(computeTokenInputHash('{"a":2}'));
  });
});
