import { describe, it, expect } from 'vitest';
import { extractAllowedComponentsFromTypeText } from '../../../src/analyze/extract/slot-allowed-components.js';

describe('extractAllowedComponentsFromTypeText', () => {
  const propsToComponent = new Map<string, string>([
    ['HeadingProps', 'Heading'],
    ['AProps', 'A'],
    ['BProps', 'B'],
  ]);
  const componentNames = new Set(['Heading', 'A', 'B', 'Card']);

  it('extracts a single ReactElement<XProps>', () => {
    expect(
      extractAllowedComponentsFromTypeText('ReactElement<HeadingProps>', { propsToComponent, componentNames })
    ).toEqual(['Heading']);
  });

  it('extracts React.ReactElement<XProps>', () => {
    expect(
      extractAllowedComponentsFromTypeText('React.ReactElement<HeadingProps>', { propsToComponent, componentNames })
    ).toEqual(['Heading']);
  });

  it('extracts a union of ReactElement<XProps>', () => {
    expect(
      extractAllowedComponentsFromTypeText(
        'ReactElement<AProps> | ReactElement<BProps>',
        { propsToComponent, componentNames }
      )
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
      })
    ).toEqual(['Heading']);
  });

  it('deduplicates and sorts', () => {
    expect(
      extractAllowedComponentsFromTypeText(
        'ReactElement<AProps> | ReactElement<AProps> | ReactElement<BProps>',
        { propsToComponent, componentNames }
      )
    ).toEqual(['A', 'B']);
  });

  it('drops unknown props types', () => {
    expect(
      extractAllowedComponentsFromTypeText('ReactElement<ZzzProps>', { propsToComponent, componentNames })
    ).toEqual([]);
  });
});
