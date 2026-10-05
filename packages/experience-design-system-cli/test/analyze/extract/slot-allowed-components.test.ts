import { describe, it, expect } from 'vitest';
import {
  extractAllowedComponentsFromTypeText,
  extractAllowedComponentsFromJsdoc,
} from '@contentful/experience-design-system-extraction';

describe('extractAllowedComponentsFromTypeText', () => {
  const propsToComponent = new Map<string, string>([
    ['HeadingProps', 'Heading'],
    ['AProps', 'A'],
    ['BProps', 'B'],
  ]);
  const componentNames = new Set(['Heading', 'A', 'B', 'Card']);

  it('extracts a single ReactElement<XProps>', () => {
    expect(
      extractAllowedComponentsFromTypeText('ReactElement<HeadingProps>', { propsToComponent, componentNames }),
    ).toEqual(['Heading']);
  });

  it('extracts React.ReactElement<XProps>', () => {
    expect(
      extractAllowedComponentsFromTypeText('React.ReactElement<HeadingProps>', { propsToComponent, componentNames }),
    ).toEqual(['Heading']);
  });

  it('extracts a union of ReactElement<XProps>', () => {
    expect(
      extractAllowedComponentsFromTypeText('ReactElement<AProps> | ReactElement<BProps>', {
        propsToComponent,
        componentNames,
      }),
    ).toEqual(['A', 'B']);
  });

  it('ignores plain ReactNode / ReactElement without a type arg', () => {
    expect(extractAllowedComponentsFromTypeText('ReactNode', { propsToComponent, componentNames })).toEqual([]);
    expect(extractAllowedComponentsFromTypeText('ReactElement', { propsToComponent, componentNames })).toEqual([]);
  });

  it('strips null/undefined unions', () => {
    expect(
      extractAllowedComponentsFromTypeText('ReactElement<HeadingProps> | null | undefined', {
        propsToComponent,
        componentNames,
      }),
    ).toEqual(['Heading']);
  });

  it('deduplicates and sorts', () => {
    expect(
      extractAllowedComponentsFromTypeText('ReactElement<AProps> | ReactElement<AProps> | ReactElement<BProps>', {
        propsToComponent,
        componentNames,
      }),
    ).toEqual(['A', 'B']);
  });

  it('drops unknown props types', () => {
    expect(
      extractAllowedComponentsFromTypeText('ReactElement<ZzzProps>', { propsToComponent, componentNames }),
    ).toEqual([]);
  });

  it('extracts a single Snippet<[XProps]>', () => {
    expect(
      extractAllowedComponentsFromTypeText('Snippet<[HeadingProps]>', { propsToComponent, componentNames }),
    ).toEqual(['Heading']);
  });

  it('extracts a Snippet<[XProps]> with whitespace', () => {
    expect(
      extractAllowedComponentsFromTypeText('Snippet<  [  HeadingProps  ]  >', { propsToComponent, componentNames }),
    ).toEqual(['Heading']);
  });

  it('extracts a union of Snippet<[XProps]>', () => {
    expect(
      extractAllowedComponentsFromTypeText('Snippet<[AProps]> | Snippet<[BProps]>', {
        propsToComponent,
        componentNames,
      }),
    ).toEqual(['A', 'B']);
  });

  it('ignores plain Snippet without a tuple type arg', () => {
    expect(extractAllowedComponentsFromTypeText('Snippet', { propsToComponent, componentNames })).toEqual([]);
    expect(
      extractAllowedComponentsFromTypeText('Snippet<[year: number]>', { propsToComponent, componentNames }),
    ).toEqual([]);
  });

  it('extracts every props type from a union inside the tuple', () => {
    expect(
      extractAllowedComponentsFromTypeText('Snippet<[AProps | BProps]>', { propsToComponent, componentNames }),
    ).toEqual(['A', 'B']);
  });

  it('mixes Snippet and ReactElement forms in the same type text', () => {
    expect(
      extractAllowedComponentsFromTypeText('ReactElement<AProps> | Snippet<[BProps]>', {
        propsToComponent,
        componentNames,
      }),
    ).toEqual(['A', 'B']);
  });
});

describe('extractAllowedComponentsFromJsdoc', () => {
  const componentNames = new Set(['Heading', 'Button']);

  it('parses a comma-separated @allowedComponents tag', () => {
    const jsdoc = `/** @allowedComponents Heading, Button */`;
    expect(extractAllowedComponentsFromJsdoc(jsdoc, componentNames)).toEqual(['Button', 'Heading']);
  });

  it('drops unknown names', () => {
    const jsdoc = `/** @allowedComponents Heading, Widget */`;
    expect(extractAllowedComponentsFromJsdoc(jsdoc, componentNames)).toEqual(['Heading']);
  });

  it('returns [] when the tag is absent', () => {
    expect(extractAllowedComponentsFromJsdoc('/** just docs */', componentNames)).toEqual([]);
  });
});
