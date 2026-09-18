import type {
  AllowedValueSnapshotEntry,
  CdfRestorePlan,
  CdfSnapshotEntry,
  CurrentPropsQuery,
  DescriptionSnapshotEntry,
} from './snapshot-types.js';
import { groupAllowedValuesByProp } from './group-allowed-values-by-prop.js';

export type {
  AllowedValueSnapshotEntry,
  CdfRestorePlan,
  CdfSnapshotEntry,
  CurrentPropsQuery,
  DescriptionSnapshotEntry,
  RestoredAllowedValues,
} from './snapshot-types.js';

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

  return {
    byName,
    byPosition,
    descriptions: descSnapshot,
    allowedValues: groupAllowedValuesByProp(avSnapshot, nameMatchedKeys),
  };
}

function propKey(componentId: string, propName: string): string {
  return `${componentId}::${propName}`;
}
