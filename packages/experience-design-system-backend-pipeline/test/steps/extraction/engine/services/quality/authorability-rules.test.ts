import { describe, expect, it } from 'vitest';
import type {
  RawPropDefinition,
  RawSlotDefinition,
} from '../../../../../../src/steps/extraction/src/types/component.js';
import {
  hasNoPropsAndNoSlots,
  hasNoAuthoringSurface,
} from '../../../../../../src/steps/extraction/src/services/quality/helpers/authorability/evaluate-authorability.js';

function prop(overrides: Partial<RawPropDefinition> = {}): RawPropDefinition {
  return { name: 'label', type: 'string', required: false, ...overrides };
}

function slot(overrides: Partial<RawSlotDefinition> = {}): RawSlotDefinition {
  return { name: 'children', isDefault: true, ...overrides };
}

describe('hasNoPropsAndNoSlots', () => {
  it('returns true when both arrays are empty', () => {
    expect(hasNoPropsAndNoSlots([], [])).toBe(true);
  });

  it('returns false when there are props', () => {
    expect(hasNoPropsAndNoSlots([prop()], [])).toBe(false);
  });

  it('returns false when there are slots', () => {
    expect(hasNoPropsAndNoSlots([], [slot()])).toBe(false);
  });
});

describe('missing-surface review', () => {
  it.each<{ props: RawPropDefinition[]; slots: RawSlotDefinition[]; expected: boolean }>([
    { props: [], slots: [], expected: true },
    { props: [prop()], slots: [], expected: false },
    { props: [], slots: [slot()], expected: false },
    { props: [prop({ name: 'value' })], slots: [slot()], expected: false },
  ])('uses only the extracted surface arrays: %j', ({ props, slots, expected }) => {
    const component = { name: 'Surface', source: '/tmp/Surface.tsx', framework: 'react' as const, props, slots };
    for (const usesCreateContext of [undefined, false, true]) {
      expect(hasNoAuthoringSurface({ ...component, usesCreateContext })).toEqual(
        expected ? { skip: true, reason: 'component has no props and no slots' } : { skip: false },
      );
    }
  });
});
