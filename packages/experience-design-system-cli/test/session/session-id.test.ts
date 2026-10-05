import { describe, it, expect } from 'vitest';
import { generateSessionId } from '../../src/session/session-id.js';

describe('generateSessionId', () => {
  it('matches the format {word}-{word}-{4hex}', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
  });

  it('generates unique IDs across 1000 iterations', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateSessionId());
    }
    expect(ids.size).toBe(1000);
  });

  it('always contains exactly two hyphens', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateSessionId();
      const parts = id.split('-');
      expect(parts).toHaveLength(3);
      expect(parts[2]).toHaveLength(4);
    }
  });
});
