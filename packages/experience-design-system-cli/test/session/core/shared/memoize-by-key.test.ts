import { describe, it, expect, vi } from 'vitest';
import { memoizeByKey } from '../../../../src/session/core/shared/memoize-by-key.js';

describe('memoizeByKey', () => {
  it('returns the underlying lookup result on first call', () => {
    const lookup = (a: string, b: number) => `${a}:${b}`;
    const memo = memoizeByKey(lookup);
    expect(memo('c1', 0)).toBe('c1:0');
  });

  it('caches per (a, b) tuple and does not re-invoke the lookup', () => {
    const spy = vi.fn((a: string, b: number) => `${a}:${b}`);
    const memo = memoizeByKey(spy);

    memo('c1', 0);
    memo('c1', 0);
    memo('c1', 0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('distinguishes different keys', () => {
    const spy = vi.fn((a: string, b: number) => `${a}:${b}`);
    const memo = memoizeByKey(spy);

    memo('c1', 0);
    memo('c1', 1);
    memo('c2', 0);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(memo('c1', 0)).toBe('c1:0');
    expect(memo('c1', 1)).toBe('c1:1');
    expect(memo('c2', 0)).toBe('c2:0');
  });

  it('caches null results (so a repeated null lookup is not re-run)', () => {
    const spy = vi.fn((_a: string, _b: number): string | null => null);
    const memo = memoizeByKey(spy);

    expect(memo('c1', 0)).toBeNull();
    expect(memo('c1', 0)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('each call to memoizeByKey creates an independent cache', () => {
    const spy = vi.fn((a: string, b: number) => `${a}:${b}`);
    const memoA = memoizeByKey(spy);
    const memoB = memoizeByKey(spy);

    memoA('c1', 0);
    memoB('c1', 0);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
