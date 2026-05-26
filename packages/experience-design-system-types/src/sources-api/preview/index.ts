export interface BreakingChange {
  propertyId: string;
  reason: 'removed' | 'added_required_no_default' | 'type_changed' | 'validation_narrowed';
}

export interface ChangeClassification {
  classification: 'breaking' | 'compatible';
  breakingChanges: BreakingChange[];
}

export interface DownstreamImpact {
  affectedFragments: number;
  affectedExperiences: number;
}

export interface PropertySummary {
  type: string;
  category: string;
  required: boolean;
  default?: unknown;
}

export interface ComponentTypeSummary {
  id: string;
  name: string;
  contentProperties: string[];
  designProperties: string[];
  slots: string[];
  fullProperties?: Record<string, PropertySummary>;
}

export interface DesignTokenSummary {
  id: string;
  name: string;
  kind: string;
}

export interface TaxonomySummary {
  id: string;
  name: string;
  tokenIds: string[];
}

export interface ChangedEntity<TCurrent, TProposed> {
  current: TCurrent;
  proposed: TProposed;
  hasPendingDraftChanges: boolean;
  changeClassification?: ChangeClassification;
  impact?: DownstreamImpact;
}

export interface EntityDiffGroup<TCurrent, TProposed> {
  new: TProposed[];
  changed: ChangedEntity<TCurrent, TProposed>[];
  unchanged: string[];
  removed: TCurrent[];
}

export interface ServerPreviewResponse {
  components: EntityDiffGroup<ComponentTypeSummary, Record<string, unknown>>;
  tokens: EntityDiffGroup<DesignTokenSummary, Record<string, unknown>>;
  taxonomies: EntityDiffGroup<TaxonomySummary, Record<string, unknown>>;
}
