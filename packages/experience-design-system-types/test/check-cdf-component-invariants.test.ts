import { describe, it, expect } from 'vitest';
import { checkCDFComponentInvariants, type CDFComponentEntry } from '../src/cdf/index.js';

function component(overrides: Partial<CDFComponentEntry> = {}): CDFComponentEntry {
  return {
    $type: 'component',
    $description: 'A component',
    $properties: {
      label: { $type: 'string', $category: 'content', $description: 'A label' },
    },
    ...overrides,
  } as CDFComponentEntry;
}

describe('checkCDFComponentInvariants', () => {
  it('reports no errors for a fully-described component', () => {
    const errors = checkCDFComponentInvariants([{ key: 'Button', entry: component() }]);
    expect(errors).toHaveLength(0);
  });

  it('flags a component missing its own $description', () => {
    const entry = component({ $description: undefined });
    const errors = checkCDFComponentInvariants([{ key: 'Button', entry }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: '/Button/$description' });
  });

  it('flags a property missing $description', () => {
    const entry = component({
      $properties: { label: { $type: 'string', $category: 'content' } as CDFComponentEntry['$properties'][string] },
    });
    const errors = checkCDFComponentInvariants([{ key: 'Button', entry }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: '/Button/$properties/label/$description' });
  });

  it('flags an enum property with no $values', () => {
    const entry = component({
      $properties: {
        variant: {
          $type: 'enum',
          $category: 'design',
          $description: 'Visual variant',
        } as CDFComponentEntry['$properties'][string],
      },
    });
    const errors = checkCDFComponentInvariants([{ key: 'Button', entry }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: '/Button/$properties/variant/$values' });
  });

  it('flags an enum property with an empty $values array', () => {
    const entry = component({
      $properties: {
        variant: {
          $type: 'enum',
          $category: 'design',
          $description: 'Visual variant',
          $values: [],
        } as CDFComponentEntry['$properties'][string],
      },
    });
    const errors = checkCDFComponentInvariants([{ key: 'Button', entry }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: '/Button/$properties/variant/$values' });
  });

  it('does not require $values on a non-enum property', () => {
    const entry = component({
      $properties: {
        bgColor: {
          $type: 'token',
          $category: 'design',
          $description: 'Background color',
          '$token.kind': 'color',
        } as CDFComponentEntry['$properties'][string],
      },
    });
    const errors = checkCDFComponentInvariants([{ key: 'Button', entry }]);
    expect(errors).toHaveLength(0);
  });

  it('collects errors across multiple components', () => {
    const errors = checkCDFComponentInvariants([
      { key: 'Button', entry: component({ $description: undefined }) },
      { key: 'Card', entry: component({ $description: undefined }) },
    ]);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.path)).toEqual(['/Button/$description', '/Card/$description']);
  });
});
