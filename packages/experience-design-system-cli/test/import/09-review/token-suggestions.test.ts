import { describe, it, expect } from 'vitest';
import { collectTokenSuggestions } from '../../../src/tui/import/steps/09-review/token-suggestions.js';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

const ENTRY: CDFComponentEntry = {
  $type: 'component',
  $properties: {
    bgColor: {
      $type: 'token',
      $category: 'design',
      '$token.kind': 'color',
      '$token.allowed': ['colors.surface.default', 'colors.surface.raised'],
    },
    label: { $type: 'string', $category: 'content' },
    borderColor: { $type: 'token', $category: 'design', '$token.kind': 'color' },
  },
};

describe('collectTokenSuggestions', () => {
  it('returns design-token props with a declared token kind', () => {
    expect(collectTokenSuggestions(ENTRY)).toEqual([
      {
        propName: 'bgColor',
        paths: ['colors.surface.default', 'colors.surface.raised'],
        suggested: ['colors.surface.default', 'colors.surface.raised'],
        allowed: ['colors.surface.default', 'colors.surface.raised'],
      },
      {
        propName: 'borderColor',
        paths: [],
        suggested: [],
        allowed: [],
      },
    ]);
  });

  it('includes every token whose type matches the property kind', () => {
    expect(
      collectTokenSuggestions(ENTRY, [
        { path: 'colors.surface.default', kind: 'color' },
        { path: 'colors.brand.primary', kind: 'color' },
        { path: 'colors.surface.raised', kind: 'color' },
        { path: 'spacing.small', kind: 'dimension' },
      ])[0],
    ).toEqual({
      propName: 'bgColor',
      paths: ['colors.surface.default', 'colors.brand.primary', 'colors.surface.raised'],
      suggested: ['colors.surface.default', 'colors.surface.raised'],
      allowed: ['colors.surface.default', 'colors.surface.raised'],
    });
  });

  it('excludes persisted allowed paths that do not match the property kind when a catalog is available', () => {
    const entry: CDFComponentEntry = {
      $type: 'component',
      $properties: {
        bgColor: {
          $type: 'token',
          $category: 'design',
          '$token.kind': 'color',
          '$token.allowed': ['colors.surface.default', 'spacing.small'],
        },
      },
    };

    expect(
      collectTokenSuggestions(entry, [
        { path: 'colors.surface.default', kind: 'color' },
        { path: 'colors.brand.primary', kind: 'color' },
        { path: 'spacing.small', kind: 'dimension' },
      ]),
    ).toEqual([
      {
        propName: 'bgColor',
        paths: ['colors.surface.default', 'colors.brand.primary'],
        suggested: ['colors.surface.default'],
        allowed: ['colors.surface.default'],
      },
    ]);
  });

  it('includes a token prop with no allowed paths so manually converted props can be reviewed', () => {
    const entry: CDFComponentEntry = {
      $type: 'component',
      $properties: {
        radiusX: { $type: 'token', $category: 'design', '$token.kind': 'dimension' },
      },
    };
    expect(
      collectTokenSuggestions(entry, [
        { path: 'radius.small', kind: 'dimension' },
        { path: 'radius.large', kind: 'dimension' },
        { path: 'colors.brand.primary', kind: 'color' },
      ]),
    ).toEqual([
      {
        propName: 'radiusX',
        paths: ['radius.small', 'radius.large'],
        suggested: [],
        allowed: [],
      },
    ]);
  });

  it('excludes a token prop when $token.allowed is absent', () => {
    const entry: CDFComponentEntry = {
      $type: 'component',
      $properties: {
        fg: { $type: 'token', $category: 'design' },
      },
    };
    expect(collectTokenSuggestions(entry)).toEqual([]);
  });
});
