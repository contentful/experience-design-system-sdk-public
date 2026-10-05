import { describe, expect, it } from 'vitest';
import { isDomPassThroughProp } from '../../../src/extract/services/classification/helpers/detect-dom-props.js';

describe('isDomPassThroughProp', () => {
  it('returns true for className', () => expect(isDomPassThroughProp('className')).toBe(true));
  it('returns true for style', () => expect(isDomPassThroughProp('style')).toBe(true));
  it('returns true for id', () => expect(isDomPassThroughProp('id')).toBe(true));
  it('returns true for role', () => expect(isDomPassThroughProp('role')).toBe(true));
  it('returns true for sx (MUI escape hatch)', () => expect(isDomPassThroughProp('sx')).toBe(true));
  it('returns true for as (polymorphic)', () => expect(isDomPassThroughProp('as')).toBe(true));
  it('returns true for modelValue (Vue v-model)', () => expect(isDomPassThroughProp('modelValue')).toBe(true));

  it('returns true for aria-label (kebab)', () => expect(isDomPassThroughProp('aria-label')).toBe(true));
  it('returns true for aria-hidden (kebab)', () => expect(isDomPassThroughProp('aria-hidden')).toBe(true));
  it('returns true for ariaLabel (camel)', () => expect(isDomPassThroughProp('ariaLabel')).toBe(true));

  it('returns true for data- prefixed props', () => {
    expect(isDomPassThroughProp('data-testid')).toBe(true);
    expect(isDomPassThroughProp('data-cy')).toBe(true);
  });

  it('returns false for label', () => expect(isDomPassThroughProp('label')).toBe(false));
  it('returns false for title', () => expect(isDomPassThroughProp('title')).toBe(false));
  it('returns false for variant', () => expect(isDomPassThroughProp('variant')).toBe(false));
  it('returns false for onClick (handled separately by handler check)', () => {
    expect(isDomPassThroughProp('onClick')).toBe(false);
  });
});
