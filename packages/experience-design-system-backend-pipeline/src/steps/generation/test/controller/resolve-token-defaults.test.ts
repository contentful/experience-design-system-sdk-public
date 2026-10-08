import { describe, expect, it } from 'vitest';
import { resolveTokenDefaults } from '../../src/controller/token-defaults/resolve-token-defaults.js';

const leaves = [
  { path: 'colors.brand.primary', type: 'color' },
  { path: 'colors.brand.secondary', type: 'color' },
  { path: 'spacing.md', type: 'dimension' },
];

describe('resolveTokenDefaults', () => {
  it('maps an exact path when its type matches', () => {
    const r = resolveTokenDefaults({
      defaults: [{ rawDefault: 'colors.brand.primary', tokenKind: 'color' }],
      leaves,
    });
    expect(r.mappings).toEqual({ 'colors.brand.primary': 'colors.brand.primary' });
    expect(r.diagnostics).toEqual([]);
  });

  it('reports a type_mismatch when the exact path exists but is the wrong kind', () => {
    const r = resolveTokenDefaults({
      defaults: [{ rawDefault: 'colors.brand.primary', tokenKind: 'dimension' }],
      leaves,
    });
    expect(r.mappings).toEqual({});
    expect(r.diagnostics[0].reason).toBe('type_mismatch');
  });

  it('reports no_match when the name is not a leaf', () => {
    const r = resolveTokenDefaults({
      defaults: [{ rawDefault: 'nope.nope', tokenKind: 'color' }],
      leaves,
    });
    expect(r.diagnostics[0].reason).toBe('no_match');
  });
});
