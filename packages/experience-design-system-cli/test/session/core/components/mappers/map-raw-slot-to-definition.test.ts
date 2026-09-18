import { describe, it, expect } from 'vitest';
import { mapRawSlotToDefinition } from '../../../../../src/session/core/components/mappers/map-raw-slot-to-definition.js';
import type { RawSlotRow } from '../../../../../src/session/repositories/components/raw/interfaces/raw-slot-row.js';

function row(overrides: Partial<RawSlotRow> = {}): RawSlotRow {
  return {
    component_id: 'c1',
    name: 'children',
    is_default: 1,
    description: null,
    position: 0,
    ...overrides,
  };
}

describe('mapRawSlotToDefinition', () => {
  it('produces the minimal shape when only required columns are set', () => {
    expect(mapRawSlotToDefinition(row(), undefined)).toEqual({
      name: 'children',
      isDefault: true,
    });
  });

  it('coerces is_default=0 to false', () => {
    expect(mapRawSlotToDefinition(row({ is_default: 0 }), undefined).isDefault).toBe(false);
  });

  it('omits nullable columns rather than emitting nulls', () => {
    const slot = mapRawSlotToDefinition(row(), undefined);
    expect(slot).not.toHaveProperty('description');
    expect(slot).not.toHaveProperty('allowedComponents');
  });

  it('surfaces description and allowedComponents when populated', () => {
    const slot = mapRawSlotToDefinition(row({ description: 'Trailing icon slot' }), [
      { component_id: 'c1', slot_name: 'children', position: 0, allowed_component: 'Icon' },
      { component_id: 'c1', slot_name: 'children', position: 1, allowed_component: 'Badge' },
    ]);
    expect(slot).toEqual({
      name: 'children',
      isDefault: true,
      description: 'Trailing icon slot',
      allowedComponents: ['Icon', 'Badge'],
    });
  });

  it('drops allowedComponents when the array is empty', () => {
    expect(mapRawSlotToDefinition(row(), [])).not.toHaveProperty('allowedComponents');
  });
});
