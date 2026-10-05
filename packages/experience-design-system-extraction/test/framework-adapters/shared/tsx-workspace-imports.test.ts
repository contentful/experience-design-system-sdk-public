import { describe, expect, it } from 'vitest';
import {
  isBareModuleSpecifier,
  matchTsConfigPathPattern,
  substituteTsConfigPathTarget,
} from '../../../src/extract/framework-adapters/shared/helpers/resolve-tsx-workspace-imports.js';

describe('isBareModuleSpecifier', () => {
  it('returns true for a package name', () => {
    expect(isBareModuleSpecifier('react')).toBe(true);
  });

  it('returns true for a scoped package', () => {
    expect(isBareModuleSpecifier('@org/package')).toBe(true);
  });

  it('returns false for a relative path', () => {
    expect(isBareModuleSpecifier('./foo')).toBe(false);
  });

  it('returns false for an absolute path', () => {
    expect(isBareModuleSpecifier('/absolute/path')).toBe(false);
  });
});

describe('matchTsConfigPathPattern', () => {
  it('matches an exact pattern with no wildcard', () => {
    expect(matchTsConfigPathPattern('@ui/components', '@ui/components')).toEqual({ matched: true });
  });

  it('does not match a non-matching exact pattern', () => {
    expect(matchTsConfigPathPattern('@ui/components', '@ui/icons')).toEqual({ matched: false });
  });

  it('matches a wildcard pattern and returns the captured segment', () => {
    const result = matchTsConfigPathPattern('@ui/*', '@ui/Button');
    expect(result).toEqual({ matched: true, wildcard: 'Button' });
  });

  it('does not match when prefix does not match', () => {
    expect(matchTsConfigPathPattern('@ui/*', '@other/Button')).toEqual({ matched: false });
  });

  it('captures an empty wildcard when specifier exactly equals the non-wildcard parts', () => {
    const result = matchTsConfigPathPattern('prefix*suffix', 'prefixsuffix');
    expect(result).toEqual({ matched: true, wildcard: '' });
  });
});

describe('substituteTsConfigPathTarget', () => {
  it('replaces the wildcard in a target pattern', () => {
    expect(substituteTsConfigPathTarget('src/*/index.ts', 'Button')).toBe('src/Button/index.ts');
  });

  it('returns the pattern unchanged when wildcard is undefined', () => {
    expect(substituteTsConfigPathTarget('src/index.ts', undefined)).toBe('src/index.ts');
  });
});
