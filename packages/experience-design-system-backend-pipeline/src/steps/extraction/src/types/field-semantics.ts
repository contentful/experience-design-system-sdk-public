import type { SourceGraphNode } from '@contentful/experience-design-system-types';
import type { CompilerCoverage, SourceFactLocation } from '../candidates/types.js';
import type { SourceObservationContext } from './component-source-observations.js';

export interface ConditionalFieldClaim {
  status: 'conditional' | 'unknown';
  premises: string[];
  reasons: string[];
}
export interface SourceFieldSemanticProof {
  inputName: string;
  path: NonNullable<SourceGraphNode['path']>;
  valueIndependence: ConditionalFieldClaim;
  omissionSafety: ConditionalFieldClaim;
  outputDependence: 'possible' | 'not-observed' | 'unknown';
}
/** Conditional language semantics do not authorize changing an authoring schema. */
export interface SourceFieldSemantics {
  schemaVersion: 1;
  semantics: 'conditional-ordered-field-flow';
  componentDeclarationId: string;
  source: SourceFactLocation;
  coverage: CompilerCoverage;
  proofs: SourceFieldSemanticProof[];
  steps: Array<{
    operation: 'binding' | 'spread' | 'write' | 'read' | 'call' | 'return' | 'branch';
    frame: number;
    location: SourceFactLocation;
    conditions: SourceObservationContext['conditions'];
  }>;
  omissions: Array<{ reason: string; location: SourceFactLocation }>;
  used: { nodes: number; maxDepth: number };
}

export function mapFieldSemanticsLocations(
  value: SourceFieldSemantics,
  map: (location: SourceFactLocation) => SourceFactLocation,
): SourceFieldSemantics {
  return {
    ...value,
    source: map(value.source),
    steps: value.steps.map((step) => ({
      ...step,
      location: map(step.location),
      conditions: step.conditions.map((condition) => ({ ...condition, location: map(condition.location) })),
    })),
    omissions: value.omissions.map((omission) => ({ ...omission, location: map(omission.location) })),
  };
}
