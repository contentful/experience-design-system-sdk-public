import { describe, expect, it } from 'vitest';
import { resolveTokenDefaults } from '../../src/map-tokens/resolve-defaults.js';

const leaves = [
  { path: 'border-radius.border-radius-small', type: 'dimension' },
  { path: 'colors.brand.primary', type: 'color' },
];

describe('resolveTokenDefaults', () => {
  it('preserves an exact compatible DTCG leaf path', () => {
    expect(resolveTokenDefaults([{ rawDefault: 'colors.brand.primary', tokenKind: 'color' }], leaves)).toEqual({
      mappings: { 'colors.brand.primary': 'colors.brand.primary' },
      diagnostics: [],
    });
  });

  it('resolves a terminal member alias to its compatible DTCG leaf path', () => {
    expect(resolveTokenDefaults([{ rawDefault: 'tokens.borderRadiusSmall', tokenKind: 'dimension' }], leaves)).toEqual({
      mappings: { 'tokens.borderRadiusSmall': 'border-radius.border-radius-small' },
      diagnostics: [],
    });
  });

  it('allows multiple aliases to resolve to one DTCG leaf path', () => {
    expect(
      resolveTokenDefaults(
        [
          { rawDefault: 'tokens.borderRadiusSmall', tokenKind: 'dimension' },
          { rawDefault: 'theme.radius.borderRadiusSmall', tokenKind: 'dimension' },
        ],
        leaves,
      ),
    ).toEqual({
      mappings: {
        'tokens.borderRadiusSmall': 'border-radius.border-radius-small',
        'theme.radius.borderRadiusSmall': 'border-radius.border-radius-small',
      },
      diagnostics: [],
    });
  });

  it('reports a no-match diagnostic without guessing', () => {
    const result = resolveTokenDefaults([{ rawDefault: 'tokens.unknownRadius', tokenKind: 'dimension' }], leaves);

    expect(result.mappings).toEqual({});
    expect(result.diagnostics).toMatchObject([
      {
        rawDefault: 'tokens.unknownRadius',
        tokenKind: 'dimension',
        reason: 'no_match',
        candidatePaths: [],
      },
    ]);
  });

  it('rejects ambiguous normalised leaf names', () => {
    const result = resolveTokenDefaults(
      [{ rawDefault: 'tokens.borderRadiusSmall', tokenKind: 'dimension' }],
      [
        { path: 'border-radius.border-radius-small', type: 'dimension' },
        { path: 'legacy.borderRadiusSmall', type: 'dimension' },
      ],
    );

    expect(result.mappings).toEqual({});
    expect(result.diagnostics).toMatchObject([
      {
        reason: 'ambiguous',
        candidatePaths: ['border-radius.border-radius-small', 'legacy.borderRadiusSmall'],
      },
    ]);
  });

  it('rejects matching leaf names with a DTCG type mismatch', () => {
    const result = resolveTokenDefaults([{ rawDefault: 'tokens.borderRadiusSmall', tokenKind: 'color' }], leaves);

    expect(result.mappings).toEqual({});
    expect(result.diagnostics).toMatchObject([
      {
        reason: 'type_mismatch',
        candidatePaths: ['border-radius.border-radius-small'],
      },
    ]);
  });

  it('does not persist one raw alias when property kinds resolve it to different paths', () => {
    const result = resolveTokenDefaults(
      [
        { rawDefault: 'tokens.borderRadiusSmall', tokenKind: 'dimension' },
        { rawDefault: 'tokens.borderRadiusSmall', tokenKind: 'color' },
      ],
      [
        { path: 'border-radius.border-radius-small', type: 'dimension' },
        { path: 'colors.border-radius-small', type: 'color' },
      ],
    );

    expect(result.mappings).toEqual({});
    expect(result.diagnostics).toMatchObject([
      {
        rawDefault: 'tokens.borderRadiusSmall',
        reason: 'ambiguous',
        candidatePaths: ['border-radius.border-radius-small', 'colors.border-radius-small'],
      },
    ]);
    expect(result.diagnostics[0]!.message).toContain('different compatible DTCG leaves across properties');
  });

  it('does not persist a raw alias when another property occurrence has a type mismatch', () => {
    const result = resolveTokenDefaults(
      [
        { rawDefault: 'tokens.borderRadiusSmall', tokenKind: 'dimension' },
        { rawDefault: 'tokens.borderRadiusSmall', tokenKind: 'color' },
      ],
      [{ path: 'border-radius.border-radius-small', type: 'dimension' }],
    );

    expect(result.mappings).toEqual({});
    expect(result.diagnostics).toMatchObject([
      {
        rawDefault: 'tokens.borderRadiusSmall',
        tokenKind: 'color',
        reason: 'type_mismatch',
        candidatePaths: ['border-radius.border-radius-small'],
      },
    ]);
  });
});
