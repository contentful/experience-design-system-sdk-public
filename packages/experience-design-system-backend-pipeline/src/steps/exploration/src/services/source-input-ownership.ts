import {
  SourceInputAssociationSchema,
  validateSourceInputOwners,
  validateCDFSourceOwnerContract,
  type SourceInputAssociation,
  type SlotDecision,
  type CDFComponentEntry,
} from '@contentful/experience-design-system-types';
import type { RawComponentDefinition } from '../../../extraction/src/types/component.js';

export function validateComponentSourceInput(
  component: RawComponentDefinition & { component_id?: string },
  input: SourceInputAssociation,
): void {
  const observations = component.componentFacts?.sourceObservations;
  const flow = observations?.inputOutput;
  if (
    !SourceInputAssociationSchema.safeParse(input).success ||
    input.inputPath[0] !== input.inputName ||
    !component.sourceCandidates?.some(
      (candidate) =>
        candidate.name === input.inputName &&
        candidate.evidenceKinds.includes('declaration') &&
        JSON.stringify(candidate.keyPath) === JSON.stringify(input.inputPath),
    ) ||
    !observations?.observations.some(
      (observation) =>
        observation.kind === 'binding' &&
        observation.inputPath?.segments.length === 0 &&
        observation.inputPath.parameterIndex === 0 &&
        observation.inputPath.rootSymbolId === input.rootSymbolId &&
        observation.inputPath.rootDeclaration.binding === 'verified',
    ) ||
    component.component_id !== input.componentId ||
    observations?.componentDeclarationId !== input.componentDeclarationId ||
    flow?.componentDeclarationId !== input.componentDeclarationId ||
    !flow.inputs.some(
      (declared) =>
        declared.name === input.inputName &&
        declared.rootSymbolId === input.rootSymbolId &&
        JSON.stringify(declared.inputPath) === JSON.stringify(input.inputPath) &&
        declared.declaration.binding === 'verified',
    ) ||
    component.componentFacts?.sourceClosure?.binding !== 'verified'
  )
    throw new Error('Source input association does not match bound component/input identity');
}
export function validateAcceptedSourceOwners(
  component: RawComponentDefinition & { component_id?: string },
  decisions: readonly SlotDecision[],
): void {
  validateSourceInputOwners(
    decisions.map((decision) => ({
      name: decision.slot,
      sourceInput: decision.state === 'open' || decision.state === 'finite' ? decision.sourceInput : undefined,
    })),
  );
  for (const decision of decisions) {
    if (
      decision.name !== component.name ||
      decision.source !== component.source ||
      decision.componentId !== component.component_id
    )
      throw new Error('Accepted source owner component identity mismatch');
    if (decision.sourceInput) validateComponentSourceInput(component, decision.sourceInput);
  }
}
export function validateCDFSourceOwners(
  component: RawComponentDefinition & { component_id?: string },
  entry: CDFComponentEntry,
): void {
  const slots = Object.entries(entry.$slots ?? {}).map(([name, slot]) => ({
    name: `slot:${name}`,
    sourceInput: slot.$sourceInput,
  }));
  const properties = Object.entries(entry.$properties).map(([name, property]) => ({
    name: `property:${name}`,
    sourceInput: property.$sourceInput,
  }));
  validateCDFSourceOwnerContract(entry);
  for (const owner of [...slots, ...properties])
    if (owner.sourceInput) validateComponentSourceInput(component, owner.sourceInput);
}
