import { describe, expect, it } from 'vitest';
import { hashContent } from '../session/cache-keys.js';

describe('hashContent', () => {
  it('is stable across invocations', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
  });

  it('returns a 64-char sha256 hex digest', () => {
    const h = hashContent('abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('differs for different inputs', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});
