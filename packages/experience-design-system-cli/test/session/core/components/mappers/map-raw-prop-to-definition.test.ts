import { describe, it, expect } from 'vitest';
import { mapRawPropToDefinition } from '../../../../../src/session/core/components/mappers/map-raw-prop-to-definition.js';
import type { RawPropRow } from '../../../../../src/session/repositories/components/raw/interfaces/raw-prop-row.js';

function row(overrides: Partial<RawPropRow> = {}): RawPropRow {
  return {
    component_id: 'c1',
    name: 'variant',
    type: 'string',
    required: 0,
    category: null,
    default_value: null,
    description: null,
    token_reference: null,
    position: 0,
    rationale: null,
    source_start_line: null,
    source_end_line: null,
    ...overrides,
  };
}

describe('mapRawPropToDefinition', () => {
  it('produces the minimal shape when only required columns are set', () => {
    expect(mapRawPropToDefinition(row(), undefined)).toEqual({
      name: 'variant',
      type: 'string',
      required: false,
    });
  });

  it('coerces required=1 to true', () => {
    expect(mapRawPropToDefinition(row({ required: 1 }), undefined).required).toBe(true);
  });

  it('omits nullable columns rather than emitting nulls', () => {
    const prop = mapRawPropToDefinition(row(), undefined);
    expect(prop).not.toHaveProperty('category');
    expect(prop).not.toHaveProperty('defaultValue');
    expect(prop).not.toHaveProperty('description');
    expect(prop).not.toHaveProperty('tokenReference');
    expect(prop).not.toHaveProperty('sourceStartLine');
    expect(prop).not.toHaveProperty('sourceEndLine');
    expect(prop).not.toHaveProperty('allowedValues');
  });

  it('surfaces every column when populated', () => {
    const prop = mapRawPropToDefinition(
      row({
        category: 'design',
        default_value: 'primary',
        description: 'Which variant to render',
        token_reference: 'color.primary',
        source_start_line: 10,
        source_end_line: 22,
      }),
      [
        { component_id: 'c1', prop_name: 'variant', position: 0, value: 'primary' },
        { component_id: 'c1', prop_name: 'variant', position: 1, value: 'secondary' },
      ],
    );
    expect(prop).toEqual({
      name: 'variant',
      type: 'string',
      required: false,
      category: 'design',
      defaultValue: 'primary',
      description: 'Which variant to render',
      tokenReference: 'color.primary',
      allowedValues: ['primary', 'secondary'],
      sourceStartLine: 10,
      sourceEndLine: 22,
    });
  });

  it('drops the allowedValues field when the array is empty', () => {
    expect(mapRawPropToDefinition(row(), [])).not.toHaveProperty('allowedValues');
  });
});
