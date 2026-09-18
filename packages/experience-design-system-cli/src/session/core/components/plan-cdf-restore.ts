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

export interface CdfRestorePlan {
  byName: CdfSnapshotEntry[];
  byPosition: CdfSnapshotEntry[];
  descriptions: DescriptionSnapshotEntry[];
  allowedValuesByPropKey: Map<string, AllowedValueSnapshotEntry[]>;
}

export interface CurrentPropsQuery {
  hasPropNamed: (componentId: string, propName: string) => boolean;
  propNameAtPosition: (componentId: string, position: number) => string | null;
}

export function planCdfRestore(
  cdfSnapshot: CdfSnapshotEntry[],
  descSnapshot: DescriptionSnapshotEntry[],
  avSnapshot: AllowedValueSnapshotEntry[],
  currentProps: CurrentPropsQuery,
): CdfRestorePlan {
  const byName: CdfSnapshotEntry[] = [];
  const byPosition: CdfSnapshotEntry[] = [];
  const restoredPropKeys = new Set<string>();

  for (const snap of cdfSnapshot) {
    if (currentProps.hasPropNamed(snap.component_id, snap.name)) {
      byName.push(snap);
      restoredPropKeys.add(`${snap.component_id}::${snap.name}`);
      continue;
    }
    const currentName = currentProps.propNameAtPosition(snap.component_id, snap.position);
    if (currentName !== null) {
      byPosition.push(snap);
      restoredPropKeys.add(`${snap.component_id}::${currentName}`);
    }
  }

  const relevantAv = avSnapshot.filter((av) => restoredPropKeys.has(`${av.component_id}::${av.prop_name}`));
  const allowedValuesByPropKey = new Map<string, AllowedValueSnapshotEntry[]>();
  for (const av of relevantAv) {
    const key = `${av.component_id}::${av.prop_name}`;
    const arr = allowedValuesByPropKey.get(key) ?? [];
    if (arr.length === 0) allowedValuesByPropKey.set(key, arr);
    arr.push(av);
  }

  return {
    byName,
    byPosition,
    descriptions: descSnapshot,
    allowedValuesByPropKey,
  };
}
