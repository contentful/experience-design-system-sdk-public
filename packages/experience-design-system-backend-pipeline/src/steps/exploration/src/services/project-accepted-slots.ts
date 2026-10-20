import type { CDFComponentEntry, SlotDecision } from '@contentful/experience-design-system-types';
export function projectAcceptedSlots(
  entry: CDFComponentEntry,
  decisions: readonly SlotDecision[] | undefined,
): CDFComponentEntry {
  if (decisions === undefined) return entry;
  const slots: NonNullable<CDFComponentEntry['$slots']> = Object.fromEntries(
    decisions
      .filter((decision) => decision.state === 'open' || decision.state === 'finite')
      .map((decision) => {
        const previous = entry.$slots?.[decision.slot];
        const description = (decision as SlotDecision & { description?: string }).description ?? previous?.$description;
        return [
          decision.slot,
          {
            ...(description ? { $description: description } : {}),
            ...(decision.required !== undefined ? { $required: decision.required } : {}),
            ...(decision.state === 'finite' ? { $allowedComponents: [...decision.allowedComponents] } : {}),
          },
        ];
      }),
  );
  const { $slots: _slots, ...rest } = entry;
  return Object.keys(slots).length ? { ...rest, $slots: slots } : rest;
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
      allowedComponents: slot.$allowedComponents ?? [],
    })),
  };
}
