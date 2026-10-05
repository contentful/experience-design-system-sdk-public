import { describe, expect, it } from 'vitest';
import type { RawComponentDefinition } from '../../../src/extract/types/component.js';
import {
  scoreComponentSourcePath,
  resolvePackageRootInfo,
  resolveComponentScopeInfo,
  resolveTopLevelFamilyName,
  isWithinComponentFamily,
  resolveDeduplicationScopeKey,
  selectPreferredComponentSource,
} from '../../../src/extract/services/deduplication/helpers/component-path-scoring.js';

function component(source: string, name = 'MyComponent'): RawComponentDefinition {
  return { name, source, sourcePath: source, framework: 'react', props: [], slots: [] };
}

describe('scoreComponentSourcePath', () => {
  it('gives a higher score to an index file', () => {
    const indexScore = scoreComponentSourcePath('/pkg/src/Button/index.tsx');
    const nonIndexScore = scoreComponentSourcePath('/pkg/src/Button/Button.tsx');
    expect(indexScore).toBeGreaterThan(nonIndexScore);
  });

  it('penalises paths with a components segment', () => {
    const withComponents = scoreComponentSourcePath('/pkg/src/components/Button/Button.tsx');
    const without = scoreComponentSourcePath('/pkg/src/Button/Button.tsx');
    expect(without).toBeGreaterThan(withComponents);
  });

  it('penalises deeper paths', () => {
    const shallow = scoreComponentSourcePath('/pkg/src/Button.tsx');
    const deep = scoreComponentSourcePath('/a/b/c/d/e/f/Button.tsx');
    expect(shallow).toBeGreaterThan(deep);
  });
});

describe('resolvePackageRootInfo', () => {
  it('splits at packages segment', () => {
    const result = resolvePackageRootInfo(['repo', 'packages', 'ui', 'src', 'Button.tsx']);
    expect(result?.rootSegments).toEqual(['repo', 'packages', 'ui']);
    expect(result?.relativeSegments).toEqual(['src', 'Button.tsx']);
  });

  it('splits at src when no packages segment', () => {
    const result = resolvePackageRootInfo(['repo', 'src', 'Button.tsx']);
    expect(result?.rootSegments).toEqual(['repo']);
    expect(result?.relativeSegments).toEqual(['src', 'Button.tsx']);
  });

  it('returns null when neither packages nor src found', () => {
    expect(resolvePackageRootInfo(['repo', 'lib', 'Button.tsx'])).toBeNull();
  });
});

describe('resolveComponentScopeInfo', () => {
  it('returns rootKey and relativeSegments for a packages path', () => {
    const result = resolveComponentScopeInfo('/repo/packages/ui/src/Button.tsx');
    expect(result?.rootKey).toBe('repo/packages/ui');
    expect(result?.relativeSegments).toEqual(['src', 'Button.tsx']);
  });

  it('returns null for a path with no recognisable root', () => {
    expect(resolveComponentScopeInfo('/lib/Button.tsx')).toBeNull();
  });
});

describe('resolveTopLevelFamilyName', () => {
  it('resolves src/components/Button/index.tsx to Button', () => {
    expect(resolveTopLevelFamilyName(['src', 'components', 'Button', 'index.tsx'])).toBe('Button');
  });

  it('resolves src/Button/index.tsx to Button', () => {
    expect(resolveTopLevelFamilyName(['src', 'Button', 'index.tsx'])).toBe('Button');
  });

  it('resolves a single-segment path (bare file)', () => {
    expect(resolveTopLevelFamilyName(['Button.tsx'])).toBe('Button');
  });

  it('returns null for a nested path with no index/match', () => {
    expect(resolveTopLevelFamilyName(['src', 'components', 'Button', 'stories', 'Button.stories.tsx'])).toBeNull();
  });
});

describe('isWithinComponentFamily', () => {
  it('returns true when file is directly under src/components/Button', () => {
    expect(isWithinComponentFamily(['src', 'components', 'Button', 'index.tsx'], 'Button')).toBe(true);
  });

  it('returns true when file is directly src/Button/index.tsx', () => {
    expect(isWithinComponentFamily(['src', 'Button', 'index.tsx'], 'Button')).toBe(true);
  });

  it('returns false for a different component directory', () => {
    expect(isWithinComponentFamily(['src', 'components', 'Card', 'index.tsx'], 'Button')).toBe(false);
  });
});

describe('resolveDeduplicationScopeKey', () => {
  it('returns a family scope key when the component is within its top-level family', () => {
    const families = new Map([['repo/packages/ui', new Set(['Button'])]]);
    const key = resolveDeduplicationScopeKey(
      '/repo/packages/ui/src/Button/index.tsx',
      'Button',
      families,
    );
    expect(key).toBe('repo/packages/ui::Button');
  });

  it('falls back to a path-based key when not within a known family', () => {
    const families = new Map<string, Set<string>>();
    const key = resolveDeduplicationScopeKey('/repo/packages/ui/src/Button/index.tsx', 'Button', families);
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });
});

describe('selectPreferredComponentSource', () => {
  it('prefers a shorter path when scores are equal', () => {
    const a = component('/repo/packages/ui/src/Button.tsx', 'Button');
    const b = component('/repo/packages/ui/src/b/c/d/Button.tsx', 'Button');
    const result = selectPreferredComponentSource(a, b);
    expect(result.winner.source).toBe(a.source);
  });

  it('prefers index file over named file', () => {
    const index = component('/repo/packages/ui/src/Button/index.tsx', 'Button');
    const named = component('/repo/packages/ui/src/Button/Button.tsx', 'Button');
    const result = selectPreferredComponentSource(named, index);
    expect(result.winner.source).toBe(index.source);
  });
});
