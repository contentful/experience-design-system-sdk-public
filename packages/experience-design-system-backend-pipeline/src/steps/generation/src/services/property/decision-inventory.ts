import type {
  DecisionInventory,
  SlotDecision,
  SourceInputAssociation,
} from '@contentful/experience-design-system-types';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';
import { validateAcceptedSourceOwners } from '../../../../exploration/src/services/source-input-ownership.js';

export function componentDecisionInventory(
  component: RawComponentDefinition,
  decisions?: readonly SlotDecision[],
): DecisionInventory {
  const accepted = decisions?.filter(
    (decision) => decision.name === component.name && decision.source === component.source,
  );
  if (accepted) validateAcceptedSourceOwners(component, accepted);
  const active = accepted?.filter((decision) => decision.state === 'open' || decision.state === 'finite');
  const roots =
    component.sourceCandidates
      ?.filter((candidate) => candidate.keyPath.length === 1)
      .map((candidate) => candidate.name) ?? [];
  if (
    new Set(roots).size !== roots.length ||
    new Set(component.props.map((prop) => prop.name)).size !== component.props.length
  )
    throw new Error('Duplicate retained source input');
  const slots = active
    ? active.map((decision) => ({
        name: decision.slot,
        ...(decision.sourceInput ? { sourceInput: decision.sourceInput.inputName } : {}),
      }))
    : component.slots.map((raw) => {
        const slot = raw as typeof raw & { sourceInput?: SourceInputAssociation };
        return { name: slot.name, ...(slot.sourceInput ? { sourceInput: slot.sourceInput.inputName } : {}) };
      });
  const owned = new Set(slots.flatMap((slot) => (slot.sourceInput === undefined ? [] : [slot.sourceInput])));
  return {
    properties: [...new Set([...roots, ...component.props.map((prop) => prop.name)])].filter(
      (name) => !owned.has(name),
    ),
    slots,
  };
}
