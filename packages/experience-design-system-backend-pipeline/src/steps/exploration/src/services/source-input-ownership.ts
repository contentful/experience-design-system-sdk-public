import {
  SourceInputAssociationSchema,
  validateSourceInputOwners,
  validateCDFSourceOwnerContract,
  type SourceInputAssociation,
  type SlotDecision,
  type CDFComponentEntry,
} from '@contentful/experience-design-system-types';
import type { RawComponentDefinition } from '../../../extraction/src/types/component.js';
import { hasBoundComponentDeclaration } from '../../../extraction/src/component-facts/component-declaration-binding.js';

function componentSourceInputIsBound(
  component: RawComponentDefinition & { component_id?: string },
  input: SourceInputAssociation,
): boolean {
  const observations = component.componentFacts?.sourceObservations;
  const flow = observations?.inputOutput;
  return !!(
    SourceInputAssociationSchema.safeParse(input).success &&
    input.inputPath[0] === input.inputName &&
    component.sourceCandidates?.some(
      (candidate) =>
        candidate.name === input.inputName &&
        candidate.evidenceKinds.includes('declaration') &&
        JSON.stringify(candidate.keyPath) === JSON.stringify(input.inputPath),
    ) &&
    observations?.observations.some(
      (observation) =>
        observation.kind === 'binding' &&
        observation.inputPath?.segments.length === 0 &&
        observation.inputPath.parameterIndex === 0 &&
        observation.inputPath.rootSymbolId === input.rootSymbolId &&
        observation.inputPath.rootDeclaration.binding === 'verified',
    ) &&
    component.component_id === input.componentId &&
    observations?.componentDeclarationId === input.componentDeclarationId &&
    flow?.componentDeclarationId === input.componentDeclarationId &&
    flow.inputs.some(
      (declared) =>
        declared.name === input.inputName &&
        declared.rootSymbolId === input.rootSymbolId &&
        JSON.stringify(declared.inputPath) === JSON.stringify(input.inputPath) &&
        declared.declaration.binding === 'verified',
    ) &&
    hasBoundComponentDeclaration(observations)
  );
}

export function validateComponentSourceInput(
  component: RawComponentDefinition & { component_id?: string },
  input: SourceInputAssociation,
): void {
  if (!componentSourceInputIsBound(component, input))
    throw new Error('Source input association does not match bound component/input identity');
}

/** Bind the original input of an already accepted slot; source flow does not decide slot authorability. */
export function bindAcceptedSlotSourceInput(
  component: RawComponentDefinition & { component_id?: string },
  decision: SlotDecision,
): SlotDecision {
  if (
    decision.sourceInput ||
    decision.provenance === 'human' ||
    !['open', 'finite'].includes(decision.state) ||
    decision.name !== component.name ||
    decision.source !== component.source ||
    decision.componentId !== component.component_id ||
    !component.component_id ||
    decision.realVotes <= 0
  )
    return decision;
  const flow = component.componentFacts?.sourceObservations?.inputOutput;
  if (!flow) return decision;
  const inputs = flow.inputs.filter(
    (input) => input.name === decision.slot && input.inputPath.length === 1 && input.inputPath[0] === decision.slot,
  );
  if (inputs.length !== 1) return decision;
  const input = inputs[0]!;
  const association: SourceInputAssociation = {
    schemaVersion: 1,
    componentId: component.component_id,
    componentDeclarationId: flow.componentDeclarationId,
    rootSymbolId: input.rootSymbolId,
    inputName: input.name,
    inputPath: [...input.inputPath],
  };
  if (!componentSourceInputIsBound(component, association)) return decision;
  const reachesOutput = flow.summaries.some(
    (summary) =>
      summary.inputName === input.name &&
      summary.state === 'positive' &&
      summary.witnessIds.some((id) =>
        flow.witnesses.some(
          (witness) =>
            witness.id === id &&
            witness.inputName === input.name &&
            witness.rootSymbolId === input.rootSymbolId &&
            witness.inputPath.length === 1 &&
            witness.inputPath[0] === input.name &&
            witness.context === 'returned' &&
            witness.strength !== 'unknown' &&
            witness.location.binding === 'verified' &&
            witness.via.every((location) => location.binding === 'verified'),
        ),
      ),
  );
  return reachesOutput ? { ...decision, sourceInput: association } : decision;
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
