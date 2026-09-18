import { describe, it, expect } from 'vitest';
import { planCdfRestore } from '../../../../src/session/core/components/plan-cdf-restore.js';

const noProps = { hasPropNamed: () => false, propNameAtPosition: () => null };

function snap(
  overrides: {
    component_id?: string;
    name?: string;
    position?: number;
    cdf_type?: string;
    cdf_category?: string;
    cdf_token_kind?: string | null;
  } = {},
) {
  return {
    component_id: overrides.component_id ?? 'c1',
    name: overrides.name ?? 'variant',
    position: overrides.position ?? 0,
    cdf_type: overrides.cdf_type ?? 'enum',
    cdf_category: overrides.cdf_category ?? 'design',
    cdf_token_kind: overrides.cdf_token_kind ?? null,
  };
}

describe('planCdfRestore', () => {
  it('returns empty plan for empty snapshot', () => {
    const plan = planCdfRestore([], [], [], noProps);
    expect(plan.byName).toEqual([]);
    expect(plan.byPosition).toEqual([]);
    expect(plan.descriptions).toEqual([]);
    expect(plan.allowedValues).toEqual([]);
  });

  it('matches by name when the prop still exists', () => {
    const plan = planCdfRestore([snap({ name: 'variant' })], [], [], {
      hasPropNamed: (_c, n) => n === 'variant',
      propNameAtPosition: () => null,
    });
    expect(plan.byName).toHaveLength(1);
    expect(plan.byPosition).toEqual([]);
  });

  it('falls back to position when the prop was renamed', () => {
    const plan = planCdfRestore([snap({ name: 'oldName', position: 3 })], [], [], {
      hasPropNamed: () => false,
      propNameAtPosition: (_c, p) => (p === 3 ? 'newName' : null),
    });
    expect(plan.byName).toEqual([]);
    expect(plan.byPosition).toHaveLength(1);
    expect(plan.byPosition[0]?.position).toBe(3);
  });

  it('drops a snapshot entry when neither name nor position matches', () => {
    const plan = planCdfRestore([snap({ name: 'gone', position: 99 })], [], [], noProps);
    expect(plan.byName).toEqual([]);
    expect(plan.byPosition).toEqual([]);
  });

  it('passes descriptions through unchanged', () => {
    const descs = [{ component_id: 'c1', description: 'A widget' }];
    const plan = planCdfRestore([], descs, [], noProps);
    expect(plan.descriptions).toEqual(descs);
  });

  it('restores allowed values for name-matched props only', () => {
    const plan = planCdfRestore(
      [snap({ name: 'variant' })],
      [],
      [
        { component_id: 'c1', prop_name: 'variant', position: 0, value: 'primary' },
        { component_id: 'c1', prop_name: 'variant', position: 1, value: 'ghost' },
        { component_id: 'c1', prop_name: 'orphan', position: 0, value: 'x' },
      ],
      { hasPropNamed: (_c, n) => n === 'variant', propNameAtPosition: () => null },
    );
    const variant = plan.allowedValues.find((av) => av.propName === 'variant');
    expect(variant?.values).toHaveLength(2);
    expect(plan.allowedValues.find((av) => av.propName === 'orphan')).toBeUndefined();
  });

  it('does NOT restore allowed values for position-matched (renamed) props', () => {
    // Matches original behavior: on rename, the CDF classification survives
    // but the AV list is dropped — the prop's meaning may have changed.
    const plan = planCdfRestore(
      [snap({ name: 'oldName', position: 3 })],
      [],
      [{ component_id: 'c1', prop_name: 'oldName', position: 0, value: 'x' }],
      { hasPropNamed: () => false, propNameAtPosition: (_c, p) => (p === 3 ? 'newName' : null) },
    );
    expect(plan.byPosition).toHaveLength(1);
    expect(plan.allowedValues).toEqual([]);
  });
});
