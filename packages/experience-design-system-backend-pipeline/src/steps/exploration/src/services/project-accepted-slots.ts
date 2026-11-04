import {
  validateSourceInputOwners,
  sourceInputOwnerKey,
  cloneJson,
  jsonEqual,
  type CDFComponentEntry,
  type SlotDecision,
} from '@contentful/experience-design-system-types';
export function projectAcceptedSlots(
  entry: CDFComponentEntry,
  decisions: readonly SlotDecision[] | undefined,
): CDFComponentEntry {
  if (decisions === undefined) return entry;
  validateSourceInputOwners(
    decisions.map((decision) => ({
      name: decision.slot,
      sourceInput: decision.state === 'open' || decision.state === 'finite' ? decision.sourceInput : undefined,
    })),
  );
  const active = decisions.filter((decision) => decision.state === 'open' || decision.state === 'finite');
  const owned = new Set(
    active.flatMap((decision) => (decision.sourceInput ? [sourceInputOwnerKey(decision.sourceInput)] : [])),
  );
  for (const property of Object.values(entry.$properties))
    if (property.$sourceInput && owned.has(sourceInputOwnerKey(property.$sourceInput)))
      throw new Error('Property and slot conflict over source input ownership');
  const properties = Object.fromEntries(
    Object.entries(entry.$properties).filter(
      ([name, property]) =>
        property.$sourceInput || !active.some((decision) => decision.sourceInput?.inputName === name),
    ),
  );
  const slots: NonNullable<CDFComponentEntry['$slots']> = Object.fromEntries(
    decisions
      .filter((decision) => decision.state === 'open' || decision.state === 'finite')
      .map((decision) => {
        const previous = entry.$slots?.[decision.slot];
        const description = (decision as SlotDecision & { description?: string }).description ?? previous?.$description;
        return [
          decision.slot,
          {
            ...(decision.sourceInput ? { $sourceInput: decision.sourceInput } : {}),
            ...(description ? { $description: description } : {}),
            ...(decision.required !== undefined ? { $required: decision.required } : {}),
            ...(decision.state === 'finite' ? { $allowedComponents: [...decision.allowedComponents] } : {}),
          },
        ];
      }),
  );
  for (const plan of Object.values(entry.$representationPlans ?? {})) {
    if (plan.kind !== 'component-model' || !plan.attachment) continue;
    const { slot, definition } = plan.attachment;
    if (!jsonEqual(entry.$slots?.[slot], definition))
      throw new Error('Generated model attachment disagrees with its selected plan');
    if (Object.hasOwn(slots, slot)) throw new Error('Source slot and generated model attachment collide');
    slots[slot] = cloneJson(definition);
  }
  const { $slots: _slots, ...rest } = entry;
  return Object.keys(slots).length
    ? { ...rest, $properties: properties, $slots: slots }
    : { ...rest, $properties: properties };
}

export function projectAcceptedRawSlots<
  T extends {
    name: string;
    source: string;
    slots: Array<{ name: string; isDefault: boolean; description?: string; allowedComponents?: string[] }>;
  },
>(component: T, decisions: readonly SlotDecision[] | undefined): T {
  if (decisions === undefined) return component;
  const accepted = decisions.filter(
    (decision) => decision.name === component.name && decision.source === component.source,
  );
  const entry = projectAcceptedSlots(
    {
      $type: 'component',
      $properties: {},
      $slots: Object.fromEntries(component.slots.map((slot) => [slot.name, { $description: slot.description }])),
    },
    accepted,
  );
  return {
    ...component,
    slots: Object.entries(entry.$slots ?? {}).map(([name, slot]) => ({
      name,
      isDefault: component.slots.find((previous) => previous.name === name)?.isDefault ?? false,
      ...(slot.$description ? { description: slot.$description } : {}),
      ...(slot.$sourceInput ? { sourceInput: slot.$sourceInput } : {}),
      allowedComponents: slot.$allowedComponents ?? [],
    })),
  };
}
