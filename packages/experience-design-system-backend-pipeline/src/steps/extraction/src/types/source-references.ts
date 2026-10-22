import type { CompilerCoverage, SourceFactLocation } from '../candidates/types.js';
import type { SourceObservationContext } from './component-source-observations.js';

export type SourceReferenceCondition = Omit<SourceObservationContext['conditions'][number], 'branch'> & {
  branch: SourceObservationContext['conditions'][number]['branch'] | 'non-nullish';
};

export interface SourceCallerValue {
  name: string;
  parameterIndex: number | null;
  state: 'provided' | 'omitted' | 'unknown';
  origin: 'fixed' | 'forwarded' | 'unknown';
  representation: 'literal' | 'jsx' | 'callback' | 'expression';
  expression: string | null;
  value?: string | number | boolean | null;
  location: SourceFactLocation;
  valueLocation: SourceFactLocation | null;
  components: Array<{ declarationId: string; location: SourceFactLocation }>;
  reasons: string[];
  parts: SourceCallerValue[];
}
export interface SourceCompilerReference {
  id: string;
  kind: 'import' | 'reexport' | 'type' | 'value' | 'assignment' | 'call' | 'jsx';
  location: SourceFactLocation;
  expression: string;
  owner: SourceFactLocation | null;
  ancestors: SourceFactLocation[];
  conditions: SourceReferenceCondition[];
  targets: Array<{ declarationId: string; location: SourceFactLocation; conditions: SourceReferenceCondition[] }>;
  inputs: SourceCallerValue[];
  history: SourceCallerValue[];
  arguments: SourceCallerValue[];
  reasons: string[];
}
export interface SourceCallerSummary {
  inputName: string;
  inputDeclaration: SourceFactLocation | null;
  constraint: {
    kind: 'finite' | 'open' | 'unknown';
    alternatives: Array<string | number | boolean | null>;
    typeText: string;
  };
  counts: { provided: number; omitted: number; unknown: number; fixed: number; forwarded: number };
  samples: Array<{
    value: string | number | boolean | null;
    location: SourceFactLocation;
    referenceId: string;
    violation: boolean;
  }>;
  components: Array<{ declarationId: string; location: SourceFactLocation; count: number }>;
  reasons: string[];
}
export interface SourceReferenceIndex {
  schemaVersion: 1;
  semantics: 'lexical-reference-observations';
  componentDeclarationId: string;
  declaration: SourceFactLocation;
  files: Array<{ location: SourceFactLocation; selected: boolean; roles: string[] }>;
  references: SourceCompilerReference[];
  summaries: SourceCallerSummary[];
  coverage: CompilerCoverage;
  limits: { maxNodes: number; maxReferences: number; maxFiles: number; maxDepth: number };
  used: { nodes: number; references: number; files: number; depth: number };
  omissions: Array<{ reason: string; location: SourceFactLocation | null; count: number }>;
}

export function mapReferenceIndexLocations(
  index: SourceReferenceIndex,
  map: (location: SourceFactLocation) => SourceFactLocation,
): SourceReferenceIndex {
  const nullable = (location: SourceFactLocation | null) => (location ? map(location) : null);
  const conditions = (items: SourceReferenceCondition[]) =>
    items.map((item) => ({ ...item, location: map(item.location) }));
  const value = (item: SourceCallerValue): SourceCallerValue => ({
    ...item,
    location: map(item.location),
    valueLocation: nullable(item.valueLocation),
    components: item.components.map((component) => ({ ...component, location: map(component.location) })),
    parts: item.parts.map(value),
  });
  return {
    ...index,
    declaration: map(index.declaration),
    files: index.files.map((file) => ({ ...file, location: map(file.location) })),
    references: index.references.map((item) => ({
      ...item,
      location: map(item.location),
      owner: nullable(item.owner),
      ancestors: item.ancestors.map(map),
      conditions: conditions(item.conditions),
      targets: item.targets.map((target) => ({
        ...target,
        location: map(target.location),
        conditions: conditions(target.conditions),
      })),
      inputs: item.inputs.map(value),
      history: item.history.map(value),
      arguments: item.arguments.map(value),
    })),
    summaries: index.summaries.map((item) => ({
      ...item,
      inputDeclaration: nullable(item.inputDeclaration),
      samples: item.samples.map((sample) => ({ ...sample, location: map(sample.location) })),
      components: item.components.map((component) => ({ ...component, location: map(component.location) })),
    })),
    omissions: index.omissions.map((item) => ({ ...item, location: nullable(item.location) })),
  };
}
