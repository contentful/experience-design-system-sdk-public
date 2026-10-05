import { describe, expect, it } from 'vitest';
import {
  isExpandableDomAttributeWrapperName,
  getDomAttributeSurface,
  EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES,
  DOM_ATTRIBUTE_WRAPPERS_WITH_SYNTHETIC_CHILDREN,
  JSX_PRIMITIVE_DOM_ATTRIBUTE_SURFACES,
} from '../src/extract/adapters/react/helpers/dom-attribute-surfaces.js';

describe('isExpandableDomAttributeWrapperName', () => {
  it('returns true for known DOM attribute wrapper names', () => {
    expect(isExpandableDomAttributeWrapperName('HTMLAttributes')).toBe(true);
    expect(isExpandableDomAttributeWrapperName('ButtonHTMLAttributes')).toBe(true);
    expect(isExpandableDomAttributeWrapperName('InputHTMLAttributes')).toBe(true);
    expect(isExpandableDomAttributeWrapperName('SVGProps')).toBe(true);
  });

  it('returns false for unknown names', () => {
    expect(isExpandableDomAttributeWrapperName('string')).toBe(false);
    expect(isExpandableDomAttributeWrapperName('ReactNode')).toBe(false);
    expect(isExpandableDomAttributeWrapperName('')).toBe(false);
  });

  it('covers all names in EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES', () => {
    for (const name of EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES) {
      expect(isExpandableDomAttributeWrapperName(name)).toBe(true);
    }
  });
});

describe('getDomAttributeSurface', () => {
  it('returns props for HTMLAttributes', () => {
    const props = getDomAttributeSurface('HTMLAttributes');
    const names = props.map((p) => p.name);
    expect(names).toContain('className');
    expect(names).toContain('id');
    expect(names).toContain('style');
  });

  it('marks all props as domAttribute: true', () => {
    const props = getDomAttributeSurface('HTMLAttributes');
    expect(props.every((p) => p.domAttribute === true)).toBe(true);
  });

  it('inherits parent props — ButtonHTMLAttributes includes HTMLAttributes props', () => {
    const props = getDomAttributeSurface('ButtonHTMLAttributes');
    const names = props.map((p) => p.name);
    expect(names).toContain('className');
    expect(names).toContain('disabled');
    expect(names).toContain('type');
  });

  it('SVGProps inherits SVGAttributes which inherits HTMLAttributes', () => {
    const props = getDomAttributeSurface('SVGProps');
    const names = props.map((p) => p.name);
    expect(names).toContain('className');
    expect(names).toContain('viewBox');
  });

  it('handles recursive cycles safely', () => {
    expect(() => getDomAttributeSurface('HTMLProps')).not.toThrow();
  });

  it('returns InputHTMLAttributes with text control surface', () => {
    const props = getDomAttributeSurface('InputHTMLAttributes');
    const names = props.map((p) => p.name);
    expect(names).toContain('autoComplete');
    expect(names).toContain('placeholder');
    expect(names).toContain('checked');
    expect(names).toContain('maxLength');
  });

  it('returns allowedValues for target attribute', () => {
    const props = getDomAttributeSurface('AnchorHTMLAttributes');
    const target = props.find((p) => p.name === 'target');
    expect(target?.allowedValues).toContain('_blank');
    expect(target?.allowedValues).toContain('_self');
  });
});

describe('DOM_ATTRIBUTE_WRAPPERS_WITH_SYNTHETIC_CHILDREN', () => {
  it('contains LabelHTMLAttributes', () => {
    expect(DOM_ATTRIBUTE_WRAPPERS_WITH_SYNTHETIC_CHILDREN.has('LabelHTMLAttributes')).toBe(true);
  });
});

describe('JSX_PRIMITIVE_DOM_ATTRIBUTE_SURFACES', () => {
  it('maps Primitive.button to ButtonHTMLAttributes', () => {
    expect(JSX_PRIMITIVE_DOM_ATTRIBUTE_SURFACES['Primitive.button']).toBe('ButtonHTMLAttributes');
  });

  it('maps Primitive.label to LabelHTMLAttributes', () => {
    expect(JSX_PRIMITIVE_DOM_ATTRIBUTE_SURFACES['Primitive.label']).toBe('LabelHTMLAttributes');
  });
});
