import { describe, it, expect } from 'vitest';
import { digestCss, renderCssDigest } from '../../src/session/css-digest.js';

describe('digestCss', () => {
  it('collects distinct attribute-selector values for a prop name', () => {
    const css = `
      :host([variant="celery"]) { color: red; }
      :host([variant="fuchsia"]) { color: blue; }
    `;
    const entries = digestCss(css, ['variant']);
    expect(entries).toEqual([{ attr: 'variant', values: ['celery', 'fuchsia'], isBoolean: false, varRefs: [] }]);
  });

  it('converts a camelCase prop name to kebab-case to match the selector', () => {
    const css = `:host([static-color]) { opacity: 1; }`;
    const entries = digestCss(css, ['staticColor']);
    expect(entries).toEqual([{ attr: 'static-color', values: [], isBoolean: true, varRefs: [] }]);
  });

  it('ignores the component name inside custom-property names — only prop-name attribute selectors count', () => {
    const css = `
      .spectrum-badge { --spectrum-badge-label-icon-color: var(--spectrum-black); }
      :host([variant="celery"]) { --spectrum-badge-color: var(--spectrum-celery); }
    `;
    const entries = digestCss(css, ['variant']);
    expect(entries).toEqual([
      { attr: 'variant', values: ['celery'], isBoolean: false, varRefs: ['--spectrum-celery'] },
    ]);
  });

  it('flags a bare attribute selector as boolean, not a one-value enum', () => {
    const css = `:host([quiet]) { opacity: 0.5; }`;
    const entries = digestCss(css, ['quiet']);
    expect(entries).toEqual([{ attr: 'quiet', values: [], isBoolean: true, varRefs: [] }]);
  });

  it('collects var(--*) references from inside a matched rule declaration block only', () => {
    const css = `
      :host([variant="celery"]) { --spectrum-badge-color: var(--spectrum-celery); }
      .unrelated { color: var(--should-not-appear); }
    `;
    const entries = digestCss(css, ['variant']);
    expect(entries[0].varRefs).toEqual(['--spectrum-celery']);
  });

  it('dedupes var(--*) references across multiple matching rules for the same attribute', () => {
    const css = `
      :host([variant="celery"]) { color: var(--spectrum-celery); }
      :host([variant="fuchsia"]) { color: var(--spectrum-celery); }
    `;
    const entries = digestCss(css, ['variant']);
    expect(entries[0].varRefs).toEqual(['--spectrum-celery']);
  });

  it('caps the var(--*) reference list per attribute', () => {
    const rules = Array.from(
      { length: 30 },
      (_, i) => `:host([variant="v${i}"]) { color: var(--token-${i}); }`,
    ).join('\n');
    const entries = digestCss(rules, ['variant']);
    expect(entries[0].varRefs.length).toBeLessThanOrEqual(20);
  });

  it('is unaffected by props with no attribute selector present in the CSS', () => {
    const css = `:host([variant="celery"]) { color: red; }`;
    const entries = digestCss(css, ['variant', 'density']);
    expect(entries).toEqual([{ attr: 'variant', values: ['celery'], isBoolean: false, varRefs: [] }]);
  });

  it('never splits a rule mid-declaration — a value spanning a `}` inside a string is still parsed correctly', () => {
    const css = `:host([variant="a}b"]) { color: red; }`;
    const entries = digestCss(css, ['variant']);
    expect(entries).toEqual([{ attr: 'variant', values: ['a}b'], isBoolean: false, varRefs: [] }]);
  });
});

describe('renderCssDigest', () => {
  it('renders enum values and states the lower-bound and boolean-attr caveats', () => {
    const entries = [
      { attr: 'variant', values: ['celery', 'fuchsia'], isBoolean: false, varRefs: ['--spectrum-celery'] },
      { attr: 'quiet', values: [], isBoolean: true, varRefs: [] },
    ];
    const block = renderCssDigest('tokens.css', entries);
    expect(block).toContain('variant: celery, fuchsia');
    expect(block).toContain('vars: --spectrum-celery');
    expect(block).toContain('[boolean] quiet');
    expect(block).toContain('lower bound');
    expect(block).toContain('not a one-value enum');
  });

  it('returns an empty string when there are no matched attributes', () => {
    expect(renderCssDigest('tokens.css', [])).toBe('');
  });
});
