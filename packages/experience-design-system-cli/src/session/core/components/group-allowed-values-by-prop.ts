import type { AllowedValueSnapshotEntry, RestoredAllowedValues } from './snapshot-types.js';

// Groups a flat list of allowed-value snapshot rows into per-prop buckets,
// keeping only rows whose `${component_id}::${prop_name}` key is in the
// allow-set. Used by planCdfRestore to reapply allowed-values only for
// props matched by name (a rename does not preserve allowed values, since
// the prop's meaning may have shifted).
export function groupAllowedValuesByProp(
  avSnapshot: AllowedValueSnapshotEntry[],
  nameMatchedKeys: ReadonlySet<string>,
): RestoredAllowedValues[] {
  const buckets = new Map<string, RestoredAllowedValues>();
  for (const av of avSnapshot) {
    const key = `${av.component_id}::${av.prop_name}`;
    if (!nameMatchedKeys.has(key)) continue;
    const bucket = buckets.get(key) ?? { componentId: av.component_id, propName: av.prop_name, values: [] };
    bucket.values.push(av);
    buckets.set(key, bucket);
  }
  return [...buckets.values()];
}
