import { describe, it, expect } from 'vitest';
import { disambiguateLabels, formatRelativeTime } from '../../src/runs/picker-labels.js';

describe('disambiguateLabels', () => {
  it('returns the leaf name for a single run', () => {
    const out = disambiguateLabels([{ id: 'A', projectPath: '/Users/tyler/repos/cx-simple-exo' }]);
    expect(out.get('A')).toBe('cx-simple-exo');
  });

  it('returns each leaf when leaves are distinct', () => {
    const out = disambiguateLabels([
      { id: 'A', projectPath: '/work/alpha' },
      { id: 'B', projectPath: '/work/beta' },
    ]);
    expect(out.get('A')).toBe('alpha');
    expect(out.get('B')).toBe('beta');
  });

  it('expands to <parent>/<leaf> when leaves collide but parents differ', () => {
    const out = disambiguateLabels([
      { id: 'A', projectPath: '/work/design-system' },
      { id: 'B', projectPath: '/personal/design-system' },
    ]);
    expect(out.get('A')).toBe('work/design-system');
    expect(out.get('B')).toBe('personal/design-system');
  });

  it('expands further when leaf and parent both collide', () => {
    const out = disambiguateLabels([
      { id: 'A', projectPath: '/root/a/design/foo' },
      { id: 'B', projectPath: '/root/b/design/foo' },
    ]);
    expect(out.get('A')).toBe('a/design/foo');
    expect(out.get('B')).toBe('b/design/foo');
  });

  it('appends numeric suffixes when full paths are identical', () => {
    const out = disambiguateLabels([
      { id: 'A', projectPath: '/work/foo' },
      { id: 'B', projectPath: '/work/foo' },
    ]);
    expect(out.get('A')).toBe('work/foo (#1)');
    expect(out.get('B')).toBe('work/foo (#2)');
  });

  it('mixes unique + collision groups in the same call', () => {
    const out = disambiguateLabels([
      { id: 'A', projectPath: '/work/design-system' },
      { id: 'B', projectPath: '/personal/design-system' },
      { id: 'C', projectPath: '/only/here' },
    ]);
    expect(out.get('A')).toBe('work/design-system');
    expect(out.get('B')).toBe('personal/design-system');
    expect(out.get('C')).toBe('here');
  });

  it('only expands the group that collides, not siblings', () => {
    const out = disambiguateLabels([
      { id: 'A', projectPath: '/x/foo' },
      { id: 'B', projectPath: '/y/foo' },
      { id: 'C', projectPath: '/z/bar' },
    ]);
    expect(out.get('A')).toBe('x/foo');
    expect(out.get('B')).toBe('y/foo');
    expect(out.get('C')).toBe('bar');
  });

  it('returns an empty map for empty input', () => {
    expect(disambiguateLabels([])).toEqual(new Map());
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-06-25T14:31:00.000Z');

  it('returns "just now" for deltas under 60 seconds', () => {
    expect(formatRelativeTime('2026-06-25T14:30:30.000Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-06-25T14:31:00.000Z', now)).toBe('just now');
  });

  it('returns "Nm ago" for minutes', () => {
    expect(formatRelativeTime('2026-06-25T14:15:00.000Z', now)).toBe('16m ago');
    expect(formatRelativeTime('2026-06-25T13:32:00.000Z', now)).toBe('59m ago');
  });

  it('returns "Nh ago" for hours', () => {
    expect(formatRelativeTime('2026-06-25T13:31:00.000Z', now)).toBe('1h ago');
    expect(formatRelativeTime('2026-06-24T15:31:00.000Z', now)).toBe('23h ago');
  });

  it('returns "Nd ago" for days under 7', () => {
    expect(formatRelativeTime('2026-06-24T14:31:00.000Z', now)).toBe('1d ago');
    expect(formatRelativeTime('2026-06-19T14:00:00.000Z', now)).toBe('6d ago');
  });

  it('falls back to YYYY-MM-DD HH:MM at 7+ days', () => {
    const out = formatRelativeTime('2026-06-01T09:05:00.000Z', now);
    expect(out).toMatch(/^2026-06-01 \d{2}:\d{2}$/);
  });

  it('returns "just now" for future timestamps (clock skew)', () => {
    expect(formatRelativeTime('2026-06-25T15:00:00.000Z', now)).toBe('just now');
  });

  it('returns the raw string for invalid ISO input', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('not-a-date');
  });
});
