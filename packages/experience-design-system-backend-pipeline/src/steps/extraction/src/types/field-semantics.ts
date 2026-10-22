import type { CompilerCoverage, SourceFactLocation } from '../candidates/types.js';
import type { SourceObservationContext } from './component-source-observations.js';

export const FIELD_SEMANTICS_VERSION = 5;
/** Applicability must be established separately; source annotations do not prove these premises. */
export const FIELD_VALUE_PREMISES = [
  'ordinary-own-data-inputs',
  'isolated-input-tree',
  'standard-record-intrinsics',
  'standard-local-array-iteration',
] as const;

export interface ConditionalFieldClaim {
  status: 'conditional' | 'unknown';
  premises: string[];
  reasons: string[];
}
export interface SourceFieldSemanticProof {
  inputName: string;
  path: Array<{ kind: 'field'; key: string }>;
  valueIndependence: ConditionalFieldClaim;
  omissionSafety: ConditionalFieldClaim;
  outputDependence: 'possible' | 'not-observed' | 'unknown';
}
/** Conditional language semantics do not authorize changing an authoring schema. */
export interface SourceFieldSemantics {
  schemaVersion: typeof FIELD_SEMANTICS_VERSION;
  semantics: 'conditional-ordered-field-flow';
  componentDeclarationId: string;
  source: SourceFactLocation;
  coverage: CompilerCoverage;
  proofs: SourceFieldSemanticProof[];
  steps: Array<{
    operation: 'binding' | 'spread' | 'write' | 'read' | 'call' | 'return' | 'branch' | 'iterate';
    frame: number;
    iterations: number[];
    location: SourceFactLocation;
    conditions: SourceObservationContext['conditions'];
  }>;
  omissions: Array<{ reason: string; location: SourceFactLocation }>;
  used: { nodes: number; maxDepth: number };
  relationalReplay?: import('./field-replay.js').SourceFieldReplay;
}

export function fieldSemanticsClaimsAreConsistent(value: SourceFieldSemantics): boolean {
  const closed = value.coverage === 'complete-within-declared-bound' && value.omissions.length === 0;
  return value.proofs.every((proof) => {
    const independent = proof.valueIndependence;
    const omission = proof.omissionSafety;
    if (
      independent.status === 'conditional' &&
      (!closed ||
        proof.outputDependence !== 'not-observed' ||
        independent.reasons.length > 0 ||
        FIELD_VALUE_PREMISES.some((premise) => !independent.premises.includes(premise)))
    )
      return false;
    return (
      omission.status !== 'conditional' ||
      (independent.status === 'conditional' &&
        omission.reasons.length === 0 &&
        FIELD_VALUE_PREMISES.every((premise) => omission.premises.includes(premise)) &&
        omission.premises.includes('entry-delivery-admits-omission'))
    );
  });
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
