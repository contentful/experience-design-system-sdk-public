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
