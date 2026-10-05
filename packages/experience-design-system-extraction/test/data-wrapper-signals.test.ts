import { describe, expect, it } from 'vitest';
import type { RawComponentDefinition } from '../src/extract/model/component.js';
import {
  escapeRegExp,
  hasVisibleUiRender,
  collectInfraPropNames,
  mapScoreToWrapperConfidence,
  dedupeStrings,
} from '../src/extract/policies/quality/helpers/data-wrapper-signals.js';

function component(overrides: Partial<RawComponentDefinition> = {}): RawComponentDefinition {
  return {
    name: 'MyComponent',
    source: '/path/MyComponent.tsx',
    sourcePath: '/path/MyComponent.tsx',
    framework: 'react',
    props: [],
    slots: [],
    ...overrides,
  };
}

function prop(name: string) {
  return { name, type: 'string', required: false };
}

describe('escapeRegExp', () => {
  it('escapes special regex characters', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });

  it('leaves plain strings unchanged', () => {
    expect(escapeRegExp('Button')).toBe('Button');
  });
});

describe('hasVisibleUiRender', () => {
  it('returns true when source contains return (<div>)', () => {
    expect(hasVisibleUiRender('function Foo() { return (<div>hello</div>); }')).toBe(true);
  });

  it('returns true when source has explicit return followed by JSX tag', () => {
    expect(hasVisibleUiRender('function F() { return <Button>click</Button>; }')).toBe(true);
  });

  it('returns false when there is no JSX', () => {
    expect(hasVisibleUiRender('const x = 1;')).toBe(false);
  });

  it('returns false when JSX is only in a variable assignment (no return keyword before JSX)', () => {
    // `return\s*(?:\(|<)` won't match because `return` is not immediately followed by `(` or `<`
    expect(hasVisibleUiRender('const x = <div>just a variable assignment</div>')).toBe(false);
  });
});

describe('collectInfraPropNames', () => {
  it('returns prop names when all props are infra props', () => {
    const c = component({ props: [prop('id'), prop('locale'), prop('slug')] });
    expect(collectInfraPropNames(c)).toEqual(['id', 'locale', 'slug']);
  });

  it('returns empty array when any prop is not an infra prop', () => {
    const c = component({ props: [prop('id'), prop('label')] });
    expect(collectInfraPropNames(c)).toEqual([]);
  });

  it('returns empty array when there are no props', () => {
    expect(collectInfraPropNames(component())).toEqual([]);
  });
});

describe('mapScoreToWrapperConfidence', () => {
  it('returns 0 for score 0', () => expect(mapScoreToWrapperConfidence(0)).toBe(0));
  it('returns 2 for score 1', () => expect(mapScoreToWrapperConfidence(1)).toBe(2));
  it('returns 2 for score 2', () => expect(mapScoreToWrapperConfidence(2)).toBe(2));
  it('returns 3 for score 3', () => expect(mapScoreToWrapperConfidence(3)).toBe(3));
  it('returns 3 for score 4', () => expect(mapScoreToWrapperConfidence(4)).toBe(3));
  it('returns 4 for score 5', () => expect(mapScoreToWrapperConfidence(5)).toBe(4));
  it('returns 4 for score 6', () => expect(mapScoreToWrapperConfidence(6)).toBe(4));
  it('returns 5 for score 7+', () => expect(mapScoreToWrapperConfidence(7)).toBe(5));
});

describe('dedupeStrings', () => {
  it('removes duplicate strings', () => {
    expect(dedupeStrings(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for empty input', () => {
    expect(dedupeStrings([])).toEqual([]);
  });
});
