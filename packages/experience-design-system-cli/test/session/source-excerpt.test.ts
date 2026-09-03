import { describe, expect, it } from 'vitest';
import { excerptAroundNames } from '../../src/session/source-excerpt.js';

const filler = (lines: number, prefix = 'const filler') =>
  Array.from({ length: lines }, (_, i) => `${prefix}${i} = ${i};`).join('\n');

describe('excerptAroundNames', () => {
  it('returns the whole text untouched when it fits the budget', () => {
    const text = 'const a = 1;\nconst padding = 2;';
    expect(excerptAroundNames(text, ['padding'], 1_000)).toEqual({ content: text, usesNotShown: [] });
  });

  it('falls back to head truncation when no name occurs in the text', () => {
    const text = filler(200);
    const result = excerptAroundNames(text, ['padding'], 300);
    expect(result.content.startsWith('const filler0 = 0;')).toBe(true);
    expect(result.content.endsWith('/* truncated */')).toBe(true);
    expect(result.content.length).toBe(300 + '\n/* truncated */'.length);
    expect(result.usesNotShown).toEqual([]);
  });

  // The whole point: the decisive line sits past where head truncation
  // would have cut, and it must be the thing that survives.
  it('keeps a window around a use that sits beyond the head budget', () => {
    const text = `${filler(100)}\nconst Styled = styled.div\`padding: \${(p) => p.padding};\`;\n${filler(100, 'const tail')}`;
    const result = excerptAroundNames(text, ['padding'], 600);
    expect(result.content).toContain('padding: ${(p) => p.padding};');
    expect(result.content).not.toContain('const filler0 = 0;');
    expect(result.content.length).toBeLessThanOrEqual(600 + '\n/* truncated */'.length);
    expect(result.usesNotShown).toEqual([]);
  });

  it('merges overlapping windows into one contiguous excerpt', () => {
    const text = `${filler(50)}\nconst a = props.padding;\nconst b = 1;\nconst c = props.margin;\n${filler(50, 'const tail')}`;
    const result = excerptAroundNames(text, ['padding', 'margin'], 800, 3);
    expect(result.content).toContain('const a = props.padding;\nconst b = 1;\nconst c = props.margin;');
    expect(result.content.match(/\/\* … \*\//g) ?? []).toHaveLength(0);
  });

  it('separates distant windows with an ellipsis marker', () => {
    const text = `${filler(50)}\nconst a = props.padding;\n${filler(50, 'const mid')}\nconst c = props.margin;\n${filler(50, 'const tail')}`;
    const result = excerptAroundNames(text, ['padding', 'margin'], 2_000, 2);
    expect(result.content).toContain('const a = props.padding;');
    expect(result.content).toContain('const c = props.margin;');
    expect(result.content).toContain('/* … */');
  });

  it('reports the names whose uses did not fit once the budget is spent', () => {
    const text = `${filler(50)}\nconst a = props.padding;\n${filler(50, 'const mid')}\nconst c = props.margin;\n${filler(50, 'const tail')}`;
    // 150 fits one window (about 95 chars) but not both. Later windows win,
    // so margin's use is shown and padding's is reported as cut.
    const result = excerptAroundNames(text, ['padding', 'margin'], 150, 2);
    expect(result.content).toContain('const c = props.margin;');
    expect(result.content).not.toContain('const a = props.padding;');
    expect(result.content.endsWith('/* truncated */')).toBe(true);
    expect(result.usesNotShown).toEqual(['padding']);
  });

  // In a source file the declaration comes first and the use comes last:
  // `fontColor?: ColorTokens` in the props interface, then a default in the
  // destructuring, then `color: tokens[fontColor]` in the style. Under a tight
  // budget the use is the line that decides classification, so later windows
  // must be kept in preference to earlier ones.
  it('prefers the last occurrence of a name over its declaration when the budget cannot hold both', () => {
    const text = [
      'export interface TextProps {',
      '  fontColor?: ColorTokens;',
      '}',
      filler(40, 'const between'),
      'const styles = css({',
      '  color: tokens[fontColor],',
      '});',
    ].join('\n');
    // 100 holds the use window (about 52 chars) but not the separator plus the declaration window (about 68).
    const result = excerptAroundNames(text, ['fontColor'], 100, 1);
    expect(result.content).toContain('color: tokens[fontColor],');
    expect(result.content).not.toContain('fontColor?: ColorTokens;');
  });

  // The note exists to say "the line that decides this prop is missing". A
  // cut declaration while the use is shown is not that, so it must not fire.
  it('does not report a name whose last occurrence is shown even when an earlier one was cut', () => {
    const text = [
      'export interface TextProps {',
      '  fontColor?: ColorTokens;',
      '}',
      filler(40, 'const between'),
      'const styles = css({',
      '  color: tokens[fontColor],',
      '});',
    ].join('\n');
    const result = excerptAroundNames(text, ['fontColor'], 100, 1);
    expect(result.content).toContain('color: tokens[fontColor],');
    expect(result.usesNotShown).toEqual([]);
  });

  it('reports a name whose last occurrence was cut', () => {
    const text = `${filler(40)}\nconst a = props.padding;\n${filler(40, 'const mid')}\nconst b = props.padding;\n${filler(40, 'const tail')}`;
    // Budget too small for even one window: the last window is head-sliced and
    // the use line falls outside the slice.
    const result = excerptAroundNames(text, ['padding'], 30, 3);
    expect(result.content).not.toContain('props.padding');
    expect(result.usesNotShown).toEqual(['padding']);
  });

  it('renders the kept windows in file order even though they are chosen last-first', () => {
    const text = `${filler(30)}\nconst a = props.padding;\n${filler(30, 'const mid')}\nconst c = props.margin;\n${filler(30, 'const tail')}`;
    const result = excerptAroundNames(text, ['padding', 'margin'], 2_000, 1);
    expect(result.content.indexOf('props.padding')).toBeLessThan(result.content.indexOf('props.margin'));
  });

  it('matches whole identifiers only', () => {
    const text = `${filler(100)}\nconst x = props.paddingTop;\n${filler(100, 'const tail')}`;
    const result = excerptAroundNames(text, ['padding'], 300);
    expect(result.content).not.toContain('paddingTop');
    expect(result.content.startsWith('const filler0 = 0;')).toBe(true);
  });
});
