export interface CdfSnapshotEntry {
  component_id: string;
  name: string;
  position: number;
  cdf_type: string;
  cdf_category: string;
  cdf_token_kind: string | null;
}

export interface DescriptionSnapshotEntry {
  component_id: string;
  description: string;
}

export interface AllowedValueSnapshotEntry {
  component_id: string;
  prop_name: string;
  position: number;
  value: string;
}

export interface RestoredAllowedValues {
  componentId: string;
  propName: string;
  values: AllowedValueSnapshotEntry[];
}

export interface CdfRestorePlan {
  byName: CdfSnapshotEntry[];
  byPosition: CdfSnapshotEntry[];
  descriptions: DescriptionSnapshotEntry[];
  allowedValues: RestoredAllowedValues[];
}

export interface CurrentPropsQuery {
  hasPropNamed: (componentId: string, propName: string) => boolean;
  propNameAtPosition: (componentId: string, position: number) => string | null;
}

// Decide which CDF snapshot entries to reapply after the raw table has been
// wiped and repopulated by an extraction re-run. A snapshot entry matches by
// name when the same-named prop still exists on the same component; otherwise
// by position when a prop exists at the same position (a rename). Entries
// that match neither are dropped.
//
// Allowed values are only restored for props matched by name — the original
// code preserved this behavior, and it avoids reapplying value lists to a
// prop whose meaning may have changed under the rename.
export function planCdfRestore(
  cdfSnapshot: CdfSnapshotEntry[],
  descSnapshot: DescriptionSnapshotEntry[],
  avSnapshot: AllowedValueSnapshotEntry[],
  currentProps: CurrentPropsQuery,
): CdfRestorePlan {
  const byName: CdfSnapshotEntry[] = [];
  const byPosition: CdfSnapshotEntry[] = [];
  const nameMatchedKeys = new Set<string>();

  for (const snap of cdfSnapshot) {
    if (currentProps.hasPropNamed(snap.component_id, snap.name)) {
      byName.push(snap);
      nameMatchedKeys.add(propKey(snap.component_id, snap.name));
      continue;
    }
    if (currentProps.propNameAtPosition(snap.component_id, snap.position) !== null) {
      byPosition.push(snap);
    }
  }

  const buckets = new Map<string, RestoredAllowedValues>();
  for (const av of avSnapshot) {
    const key = propKey(av.component_id, av.prop_name);
    if (!nameMatchedKeys.has(key)) continue;
    const bucket = buckets.get(key) ?? { componentId: av.component_id, propName: av.prop_name, values: [] };
    bucket.values.push(av);
    buckets.set(key, bucket);
  }

  return {
    byName,
    byPosition,
    descriptions: descSnapshot,
    allowedValues: [...buckets.values()],
  };
}

function propKey(componentId: string, propName: string): string {
  return `${componentId}::${propName}`;
}
