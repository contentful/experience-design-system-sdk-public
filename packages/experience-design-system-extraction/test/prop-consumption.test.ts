import { describe, expect, it } from 'vitest';
import { findUnconsumedProps, isPropConsumed } from '../src/prop-consumption.js';

const file = (text: string) => [{ path: 'Component.tsx', text }];

describe('isPropConsumed — member access', () => {
  it('finds props.name', () => {
    expect(isPropConsumed('margin', file('const x = props.margin ? 1 : 0;'))).toBe(true);
  });

  it('finds optional chaining', () => {
    expect(isPropConsumed('margin', file('const x = props?.margin;'))).toBe(true);
  });

  it('finds this.props.name on class components', () => {
    expect(isPropConsumed('margin', file('render() { return this.props.margin; }'))).toBe(true);
  });

  it('does not match a longer prop that merely starts with the name', () => {
    expect(isPropConsumed('margin', file('const x = props.marginTop;'))).toBe(false);
  });
});

describe('isPropConsumed — destructuring off props', () => {
  it('finds a multiline pattern', () => {
    const text = `const {
      display,
      margin,
      marginBottom,
    } = props;`;
    expect(isPropConsumed('margin', file(text))).toBe(true);
    expect(isPropConsumed('marginBottom', file(text))).toBe(true);
  });

  it('finds a single-line pattern', () => {
    expect(isPropConsumed('margin', file('const { margin } = props;'))).toBe(true);
  });

  it('finds a renamed binding', () => {
    expect(isPropConsumed('margin', file('const { margin: m } = props;'))).toBe(true);
  });

  it('finds a defaulted binding', () => {
    expect(isPropConsumed('margin', file("const { margin = 'none' } = props;"))).toBe(true);
  });

  it('accepts a type-annotated pattern', () => {
    expect(isPropConsumed('margin', file('const { margin }: BoxProps = props;'))).toBe(true);
  });

  it('accepts destructuring off this.props', () => {
    expect(isPropConsumed('margin', file('const { margin } = this.props;'))).toBe(true);
  });

  it('ignores destructuring off something that is not props', () => {
    expect(isPropConsumed('margin', file('const { margin } = styles;'))).toBe(false);
  });
});

describe('isPropConsumed — bare shorthand forwarding', () => {
  it('finds a destructured function parameter', () => {
    expect(isPropConsumed('margin', file('function Box({ margin, padding }) { return null; }'))).toBe(true);
  });

  it('finds the prop forwarded on into a call', () => {
    expect(isPropConsumed('margin', file('getSpacingStyles({ margin, marginTop });'))).toBe(true);
  });

  // The load-bearing case. `margin: 0` is a CSS declaration in an emotion style
  // object, not a use of the prop. Counting it silences the signal on exactly
  // the components the signal exists to catch.
  it('does NOT count a CSS declaration with a literal value', () => {
    expect(isPropConsumed('margin', file('const styles = css({ margin: 0, padding: 0 });'))).toBe(false);
  });

  it('does NOT count a key with any non-binding value', () => {
    expect(isPropConsumed('margin', file("const s = { margin: '2rem' };"))).toBe(false);
  });
});

describe('isPropConsumed — declaration-only occurrences', () => {
  it('does not count a type member declaration', () => {
    expect(isPropConsumed('margin', file('export interface MarginProps { margin?: Spacing; }'))).toBe(false);
  });

  it('does not count the name appearing inside a larger identifier', () => {
    const text = "import { type MarginProps } from '@contentful/f36-core';";
    expect(isPropConsumed('margin', file(text))).toBe(false);
  });

  it('is case sensitive', () => {
    expect(isPropConsumed('margin', file('const x = props.Margin;'))).toBe(false);
  });
});

describe('isPropConsumed — across files', () => {
  it('counts consumption found in any supplied file', () => {
    const sources = [
      { path: 'ProgressStepper.tsx', text: 'export interface P extends MarginProps {}' },
      { path: 'ProgressStepper.styles.ts', text: 'const s = css({ margin: 0 });' },
      { path: 'helper.ts', text: 'export const f = (props) => props.margin;' },
    ];
    expect(isPropConsumed('margin', sources)).toBe(true);
  });
});

describe('findUnconsumedProps', () => {
  it('reports only the props with no consumption evidence', () => {
    const sources = [
      {
        path: 'Box.tsx',
        text: `const { margin, padding } = props;
               getSpacingStyles({ margin, padding });`,
      },
    ];
    expect(findUnconsumedProps(['margin', 'padding', 'display'], sources)).toEqual(['display']);
  });

  it('reproduces the declared-but-never-consumed case', () => {
    const sources = [
      {
        path: 'ProgressStepper.tsx',
        text: `import { type MarginProps } from '@contentful/f36-core';
               export interface ProgressStepperProps extends CommonProps, MarginProps {}`,
      },
      {
        path: 'ProgressStepper.styles.ts',
        text: 'export const getStyles = () => ({ root: css({ margin: 0, padding: 0 }) });',
      },
    ];
    expect(findUnconsumedProps(['margin', 'marginTop', 'marginBottom'], sources)).toEqual([
      'margin',
      'marginTop',
      'marginBottom',
    ]);
  });

  // Soundness guard: with nothing to read we know nothing, so we must claim
  // nothing. Reporting every prop as unconsumed here would hand the model a
  // confident falsehood.
  it('claims nothing when no source was loaded', () => {
    expect(findUnconsumedProps(['margin'], [])).toEqual([]);
    expect(findUnconsumedProps(['margin'], [{ path: 'a.ts', text: '   ' }])).toEqual([]);
  });

  it('ignores empty prop names', () => {
    expect(findUnconsumedProps([''], [{ path: 'a.ts', text: 'const x = 1;' }])).toEqual([]);
  });
});
