import { describe, expect, it } from 'vitest';
import { BoundedResidentCache } from '../../src/memory/bounded-resident-cache.js';

describe('selective bounded residency', () => {
  it('retains frequently used units and evicts the least recently used unit when the byte limit is reached', () => {
    const cache = new BoundedResidentCache<string>({
      maxBytes: 10,
      maxEntries: 5,
      idleMs: 60000,
      underPressure: () => false,
    });
    cache.set('a', 'alpha', 4);
    cache.set('b', 'beta', 4);
    expect(cache.get('a')).toBe('alpha');
    cache.set('c', 'gamma', 4);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('alpha');
    expect(cache.get('c')).toBe('gamma');
  });
  it('expires cold units while extending residency on accesses', () => {
    let now = 0;
    const cache = new BoundedResidentCache<string>({
      maxBytes: 10,
      maxEntries: 5,
      idleMs: 1000,
      now: () => now,
      underPressure: () => false,
    });
    cache.set('a', 'alpha', 4);
    cache.set('b', 'beta', 4);
    now = 800;
    expect(cache.get('a')).toBe('alpha');
    now = 1500;
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('alpha');
  });
  it('releases retained data under pressure and resumes admission after pressure clears', () => {
    let now = 0,
      pressure = false,
      evictions = 0;
    const cache = new BoundedResidentCache<string>({
      maxBytes: 10,
      maxEntries: 5,
      idleMs: 1000,
      now: () => now,
      underPressure: () => pressure,
      onEvict: () => evictions++,
    });
    cache.set('a', 'alpha', 4);
    pressure = true;
    now = 300;
    expect(cache.get('a')).toBeUndefined();
    cache.set('b', 'beta', 4);
    expect(cache.get('b')).toBeUndefined();
    expect(evictions).toBe(1);
    pressure = false;
    now = 600;
    cache.set('c', 'gamma', 4);
    expect(cache.get('c')).toBe('gamma');
  });
  it('bounds entry count, skips oversized units and releases all data when closed', () => {
    const cache = new BoundedResidentCache<string>({
      maxBytes: 10,
      maxEntries: 1,
      idleMs: 1000,
      underPressure: () => false,
    });
    cache.set('a', 'alpha', 1);
    cache.set('b', 'beta', 1);
    expect(cache.get('a')).toBeUndefined();
    cache.set('c', 'oversized', 11);
    expect(cache.get('b')).toBe('beta');
    expect(cache.get('c')).toBeUndefined();
    cache.clear();
    expect(cache.get('b')).toBeUndefined();
  });
});
