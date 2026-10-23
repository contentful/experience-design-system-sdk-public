import type { CDFComponentEntry } from '../../cdf/index.js';
import type { DTCGTokenEntry } from '../../dtcg/index.js';
import { cloneJson, jsonValueIssue, own } from '../../property-contract/json-value.js';

export const PROPERTY_BREAKING_REASONS = [
  'removed',
  'added_required_no_default',
  'type_changed',
  'validation_narrowed',
] as const;
export const SLOT_BREAKING_REASONS = [
  'slot_removed',
  'slot_allowed_components_narrowed',
  'slot_became_required',
  'slot_added_required',
  'slot_cardinality_narrowed',
] as const;

interface PropertyBreakingChange {
  propertyId: string;
  reason: (typeof PROPERTY_BREAKING_REASONS)[number];
}

interface SlotBreakingChange {
  slotId: string;
  reason: (typeof SLOT_BREAKING_REASONS)[number];
}

export type BreakingChange = PropertyBreakingChange | SlotBreakingChange;

export function sanitizeBreakingChanges(value: unknown): BreakingChange[] {
  const unsafe = jsonValueIssue(value);
  if (!Array.isArray(value) || (unsafe && !/^\/\d+(?:\/|$)/.test(unsafe.path))) return [];
  const changes: BreakingChange[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !own(descriptor, 'value')) continue;
    const item: unknown = descriptor.value;
    if (jsonValueIssue(item) || !item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const property = own(row, 'propertyId');
    const slot = own(row, 'slotId');
    if (property === slot || Object.keys(row).some((key) => !['reason', 'propertyId', 'slotId'].includes(key)))
      continue;
    const id = property ? row.propertyId : row.slotId;
    const reasons: readonly string[] = property ? PROPERTY_BREAKING_REASONS : SLOT_BREAKING_REASONS;
    if (typeof id !== 'string' || !id.trim() || typeof row.reason !== 'string' || !reasons.includes(row.reason))
      continue;
    changes.push(cloneJson(row) as unknown as BreakingChange);
  }
  return changes;
}

export interface ChangeClassification {
  classification: 'breaking' | 'compatible';
  breakingChanges: BreakingChange[];
}

export interface DownstreamImpact {
  affectedFragments: number;
  affectedExperiences: number;
  referencedByFragment?: boolean;
}

export interface PropertySummary {
  /** Exact definition when supplied locally; omission means unknown recursive shape. */
  definition?: import('../../cdf/types.js').CDFFieldDefinition;
  targetDefinition?: import('../../property-contract/json-value.js').JsonValue;
  sourceDefinition?: import('../../property-contract/json-value.js').JsonValue;
  diagnostics?: import('../../property-contract/json-value.js').JsonValue[];
  type: string;
  category: string;
  required: boolean;
  default?: unknown;
}

export interface SlotSummary {
  definition?: import('../../cdf/types.js').CDFSlotDefinition;
  targetDefinition?: import('../../property-contract/json-value.js').JsonValue;
  sourceDefinition?: import('../../property-contract/json-value.js').JsonValue;
  required?: boolean;
  allowedComponents?: string[];
  metadata?: import('../../property-contract/json-value.js').JsonValue;
}
export interface ProjectionDiagnostic {
  componentId: string;
  propertyId: string;
  path: string;
  outcome: 'supported' | 'conditional' | 'lossy' | 'unsupported';
  code: string;
  message: string;
}
export interface ComponentTypeSummary {
  id: string;
  name: string;
  contentProperties: string[];
  designProperties: string[];
  slots: string[];
  definition?: import('../../property-contract/json-value.js').JsonValue;
  sourceDefinition?: import('../../property-contract/json-value.js').JsonValue;
  fullSlots?: Record<string, SlotSummary>;
  projectionDiagnostics?: ProjectionDiagnostic[];
  fullProperties?: Record<string, PropertySummary>;
  /**
   * Per-slot `$allowedComponents` on the currently-published version, keyed by
   * slot name. Optional so consumers that don't populate it get the previous
   * no-slot-allow-diff behavior. Empty arrays mean "no restrictions" (any).
   */
  currentSlotAllowed?: Record<string, string[]>;
  deleteBlocked?: { reason: 'fragment-referenced' };
}

export interface DesignTokenSummary {
  id: string;
  name: string;
  type: string;
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
  projectionDiagnostics?: ProjectionDiagnostic[];
}

export interface EntityDiffGroup<TCurrent, TProposed> {
  new: TProposed[];
  changed: ChangedEntity<TCurrent, TProposed>[];
  unchanged: string[];
  removed: TCurrent[];
}

export interface ProposedComponentSummary extends Partial<CDFComponentEntry> {
  key?: string;
  definition?: CDFComponentEntry;
}

export interface ServerPreviewResponse {
  components: EntityDiffGroup<ComponentTypeSummary, ProposedComponentSummary>;
  tokens: EntityDiffGroup<DesignTokenSummary, DTCGTokenEntry>;
  taxonomies: EntityDiffGroup<TaxonomySummary, TaxonomySummary>;
}
