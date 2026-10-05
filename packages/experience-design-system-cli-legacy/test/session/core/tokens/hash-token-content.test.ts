import { describe, it, expect } from 'vitest';
import { hashTokenContent } from '../../../../src/session/core/tokens/hash-token-content.js';

describe('hashTokenContent', () => {
  it('trims surrounding whitespace before hashing', () => {
    expect(hashTokenContent('{"a":1}')).toBe(hashTokenContent('  {"a":1}  '));
  });

  it('returns a 64-char sha256 hex string', () => {
    expect(hashTokenContent('{}')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes different content', () => {
    expect(hashTokenContent('{"a":1}')).not.toBe(hashTokenContent('{"a":2}'));
  });
});
