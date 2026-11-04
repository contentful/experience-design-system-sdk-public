import { type Type } from 'ts-morph';
import type { RawSlotDefinition } from '../../../types/component.js';

export function extractSlots(_type: Type, hasChildren: boolean): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];

  if (hasChildren) {
    slots.push({ name: 'children', isDefault: true });
  }

  return slots.sort((a, b) => a.name.localeCompare(b.name));
}
