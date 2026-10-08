import { describe, expect, it } from 'vitest';
import { rebuildDTCGTree } from '../helpers/rebuild-dtcg-tree.js';
import { formatDiagnostics } from '../validators/format-diagnostics.js';

describe('rebuildDTCGTree', () => {
  it('nests tokens by dotted path', () => {
    const tree = rebuildDTCGTree([], [{ path: 'color.brand.primary', $type: 'color', $value: '#FF0000' }]);
    expect(tree).toEqual({
      color: {
        brand: {
          primary: { $type: 'color', $value: '#FF0000' },
        },
      },
    });
  });

  it('applies group descriptions at matching paths', () => {
    const tree = rebuildDTCGTree(
      [{ path: 'color.brand', $description: 'Brand palette' }],
      [{ path: 'color.brand.primary', $type: 'color', $value: '#FF' }],
    );
    expect((tree['color'] as Record<string, unknown>)['brand']).toMatchObject({
      $description: 'Brand palette',
      primary: { $type: 'color', $value: '#FF' },
    });
  });
});

describe('formatDiagnostics', () => {
  it('returns a check-mark line when valid', () => {
    expect(formatDiagnostics({ valid: true, summary: 'ok', diagnostics: [] })).toBe('✓ ok');
  });

  it('lists each diagnostic with path, message, and optional expected/actual', () => {
    const out = formatDiagnostics({
      valid: false,
      summary: '',
      diagnostics: [
        { path: '/x', message: 'bad', expected: 'y', actual: 'z' },
        { path: '/w', message: 'missing' },
      ],
    });
    expect(out).toContain('✗ 2 errors found');
    expect(out).toContain('/x');
    expect(out).toContain('expected: y');
    expect(out).toContain('actual:   z');
    expect(out).toContain('/w');
    expect(out).toContain('missing');
  });
});
