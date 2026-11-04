import type { SourceFactLocation, CompilerCoverage } from '../candidates/types.js';
import type { SourceObservationContext } from './component-source-observations.js';

export interface SourceDeclaredInput {
  name: string;
  rootSymbolId: string;
  declaration: SourceFactLocation;
  parameterIndex: number;
  inputPath: string[];
}
export interface SourceOutputDestination {
  kind: 'intrinsic' | 'callable' | 'unknown';
  name: string;
  inputName: string;
  declarationId: string | null;
  location: SourceFactLocation;
}
export interface SourceInputOutputWitness {
  id: string;
  inputName: string;
  inputPath: string[];
  rootSymbolId: string;
  kind: 'returned-value' | 'intrinsic-attribute' | 'receiver-input' | 'guard';
  context: 'returned' | 'discarded' | 'deferred' | 'referenced';
  location: SourceFactLocation;
  destination: SourceOutputDestination | null;
  enclosing: SourceOutputDestination[];
  via: SourceFactLocation[];
  conditions: SourceObservationContext['conditions'];
  strength: 'exact' | 'inferred' | 'unknown';
  reasons: string[];
}
/** Bounded source dependencies preserve declared inputs; they do not establish execution or authorability. */
export interface SourceInputOutputEvidence {
  schemaVersion: 1;
  semantics: 'bounded-source-dependencies';
  componentDeclarationId: string;
  coverage: CompilerCoverage;
  inputs: SourceDeclaredInput[];
  witnesses: SourceInputOutputWitness[];
  summaries: Array<{
    inputName: string;
    state: 'positive' | 'absent' | 'open';
    scope: 'component-return';
    witnessIds: string[];
    reasons: string[];
  }>;
  omissions: Array<{ reason: string; location: SourceFactLocation | null }>;
  used: { nodes: number; maxDepth: number; witnesses: number };
}
export function mapInputOutputLocations(
  evidence: SourceInputOutputEvidence,
  map: (location: SourceFactLocation) => SourceFactLocation,
): SourceInputOutputEvidence {
  const destination = (value: SourceOutputDestination): SourceOutputDestination => ({
    ...value,
    location: map(value.location),
  });
  return {
    ...evidence,
    inputs: evidence.inputs.map((input) => ({ ...input, declaration: map(input.declaration) })),
    witnesses: evidence.witnesses.map((witness) => ({
      ...witness,
      location: map(witness.location),
      destination: witness.destination ? destination(witness.destination) : null,
      enclosing: witness.enclosing.map(destination),
      via: witness.via.map(map),
      conditions: witness.conditions.map((condition) => ({ ...condition, location: map(condition.location) })),
    })),
    omissions: evidence.omissions.map((omission) => ({
      ...omission,
      location: omission.location ? map(omission.location) : null,
    })),
  };
}
