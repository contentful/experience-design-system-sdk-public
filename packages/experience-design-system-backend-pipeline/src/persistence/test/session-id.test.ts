import { describe, expect, it } from 'vitest';
import { generateSessionId } from '../session-id.js';

describe('generateSessionId', () => {
  it('returns a string matching {adjective}-{noun}-{hex} format', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
  });

  it('returns unique IDs on repeated calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateSessionId()));
    expect(ids.size).toBeGreaterThan(1);
  });
});
