import { describe, it, expect } from 'vitest';
import { buildTokenIndex, resolveTokenReference } from '../src/token-binding.js';

const tree = {
  color: {
    $type: 'color',
    blue: { 500: { $value: '#0000ff' } },
    red: { 500: { $value: '#ff0000' } },
  },
  spacing: {
    small: { $type: 'dimension', $value: '4px' },
  },
};

describe('buildTokenIndex', () => {
  it('indexes leaves by dot path and inherits $type from the nearest ancestor', () => {
    const index = buildTokenIndex(tree);
    expect(index.get('color.blue.500')).toEqual({ path: 'color.blue.500', type: 'color' });
    expect(index.get('spacing.small')).toEqual({ path: 'spacing.small', type: 'dimension' });
  });

  it('does not index groups', () => {
    const index = buildTokenIndex(tree);
    expect(index.has('color')).toBe(false);
    expect(index.has('color.blue')).toBe(false);
  });

  it('returns an empty index for non-object input', () => {
    expect(buildTokenIndex(null).size).toBe(0);
    expect(buildTokenIndex('nope').size).toBe(0);
  });
});

describe('resolveTokenReference', () => {
  const index = buildTokenIndex(tree);
  const sidecar = { 'tokens.blue500': 'color.blue.500', '--brand-primary': 'color.red.500' };

  it('resolves a bare DTCG path directly against the index', () => {
    expect(resolveTokenReference('color.blue.500', {}, index)?.path).toBe('color.blue.500');
  });

  it('resolves a flat JS reference through the sidecar', () => {
    expect(resolveTokenReference('tokens.blue500', sidecar, index)?.type).toBe('color');
  });

  it('resolves a CSS custom property through the sidecar', () => {
    expect(resolveTokenReference('--brand-primary', sidecar, index)?.path).toBe('color.red.500');
  });

  it('unwraps var() before resolving', () => {
    expect(resolveTokenReference('var(--brand-primary)', sidecar, index)?.path).toBe('color.red.500');
  });

  it('returns undefined when the sidecar maps to a path absent from the index', () => {
    expect(resolveTokenReference('tokens.ghost', { 'tokens.ghost': 'color.ghost.500' }, index)).toBeUndefined();
  });

  it('returns undefined for a raw literal', () => {
    expect(resolveTokenReference('#ff0000', sidecar, index)).toBeUndefined();
  });
});

import { findValueTokenReferences } from '../src/token-binding.js';

describe('findValueTokenReferences', () => {
  const values = ['neutral', 'positive', 'negative'];

  it('finds references in a Record-typed object literal', () => {
    const text = `
      export const variantStyles: Record<PillVariant, { background: string }> = {
        neutral: { background: tokens.gray300 },
        positive: { background: tokens.green300 },
        negative: { background: tokens.red300 },
      };
    `;
    const found = findValueTokenReferences(values, [{ path: 'Pill.styles.ts', text }]);
    expect(found.get('neutral')).toBe('tokens.gray300');
    expect(found.get('positive')).toBe('tokens.green300');
    expect(found.get('negative')).toBe('tokens.red300');
  });

  it('finds references in a switch statement', () => {
    const text = `
      switch (variant) {
        case 'neutral': return tokens.gray300;
        case 'positive': return tokens.green300;
        case 'negative': return tokens.red300;
      }
    `;
    const found = findValueTokenReferences(values, [{ path: 'Badge.tsx', text }]);
    expect(found.get('positive')).toBe('tokens.green300');
  });

  it('finds CSS custom property references', () => {
    const text = `const map = { neutral: 'var(--gray-300)', positive: 'var(--green-300)' };`;
    const found = findValueTokenReferences(values, [{ path: 'a.ts', text }]);
    expect(found.get('neutral')).toBe('var(--gray-300)');
  });

  it('omits values whose branch holds a raw literal', () => {
    const text = `const map = { neutral: tokens.gray300, positive: '#00ff00' };`;
    const found = findValueTokenReferences(values, [{ path: 'a.ts', text }]);
    expect(found.get('neutral')).toBe('tokens.gray300');
    expect(found.has('positive')).toBe(false);
  });

  it('searches every supplied source file', () => {
    const found = findValueTokenReferences(values, [
      { path: 'a.ts', text: 'const x = { neutral: tokens.gray300 };' },
      { path: 'b.ts', text: "const y = { positive: 'color.green.300' };" },
    ]);
    expect(found.size).toBe(2);
  });

  it('returns an empty map when nothing matches', () => {
    const found = findValueTokenReferences(values, [{ path: 'a.ts', text: 'const z = 1;' }]);
    expect(found.size).toBe(0);
  });

  it('does not bleed a value into a sibling object literal that shares the same keys', () => {
    // Mirrors PillNext.tsx: an icon map and an icon-color map declare the
    // same variant keys right next to a decoy, unrelated background map.
    const text = `
      const icons = { warning: WarningIcon, negative: WarningOctagonIcon };
      const iconColors = { warning: tokens.orange400, negative: tokens.red600 };
      const bg = { warning: tokens.orange100, negative: tokens.red100 };
    `;
    const found = findValueTokenReferences(['warning', 'negative'], [{ path: 'PillNext.tsx', text }]);
    expect(found.has('warning')).toBe(false);
    expect(found.has('negative')).toBe(false);
  });

  it('bounds the branch window to the enclosing literal, not a fixed character count', () => {
    const text = `
      const map = {
        neutral: { background: tokens.gray300 },
        positive: WITHOUT_A_TOKEN,
      };
    `;
    const found = findValueTokenReferences(['neutral', 'positive'], [{ path: 'a.ts', text }]);
    expect(found.get('neutral')).toBe('tokens.gray300');
    expect(found.has('positive')).toBe(false);
  });
});

import { proveTokenBinding } from '../src/token-binding.js';

describe('proveTokenBinding', () => {
  const index = buildTokenIndex({
    color: { $type: 'color', gray: { 300: { $value: '#ccc' } }, green: { 300: { $value: '#0f0' } } },
    spacing: { small: { $type: 'dimension', $value: '4px' } },
  });
  const sidecar = { 'tokens.gray300': 'color.gray.300', 'tokens.green300': 'color.green.300' };

  it('proves a prop whose every value resolves', () => {
    const result = proveTokenBinding({
      values: ['neutral', 'positive'],
      sources: [{ path: 'a.ts', text: 'const m = { neutral: tokens.gray300, positive: tokens.green300 };' }],
      sidecar,
      index,
    });
    expect(result).toEqual({
      status: 'proven',
      kind: 'color',
      paths: ['color.gray.300', 'color.green.300'],
    });
  });

  it('de-duplicates paths when values share a token', () => {
    const result = proveTokenBinding({
      values: ['idle', 'deleted'],
      sources: [{ path: 'a.ts', text: 'const m = { idle: tokens.gray300, deleted: tokens.gray300 };' }],
      sidecar,
      index,
    });
    expect(result).toEqual({ status: 'proven', kind: 'color', paths: ['color.gray.300'] });
  });

  it('reports partial when one value fails to resolve', () => {
    const result = proveTokenBinding({
      values: ['neutral', 'positive'],
      sources: [{ path: 'a.ts', text: "const m = { neutral: tokens.gray300, positive: '#00ff00' };" }],
      sidecar,
      index,
    });
    expect(result).toEqual({ status: 'partial', resolved: ['neutral'], unresolved: ['positive'] });
  });

  it('reports none when no value resolves', () => {
    const result = proveTokenBinding({
      values: ['a', 'b'],
      sources: [{ path: 'a.ts', text: 'const m = { a: 1, b: 2 };' }],
      sidecar,
      index,
    });
    expect(result).toEqual({ status: 'none' });
  });

  it('refuses to prove a prop whose values resolve to mixed token types', () => {
    const mixedSidecar = { ...sidecar, 'tokens.small': 'spacing.small' };
    const result = proveTokenBinding({
      values: ['neutral', 'tight'],
      sources: [{ path: 'a.ts', text: 'const m = { neutral: tokens.gray300, tight: tokens.small };' }],
      sidecar: mixedSidecar,
      index,
    });
    expect(result.status).toBe('partial');
  });

  it('reports none for an empty value set', () => {
    expect(proveTokenBinding({ values: [], sources: [], sidecar, index }).status).toBe('none');
  });
});
