import type { RawSlotDefinition } from '../../../types/component.js';

export { extractFastTemplateSlots } from './extract-wc-template-content.js';

export function extractSlotsFromTemplate(templateContent: string): RawSlotDefinition[] {
  const slots = new Map<string, boolean>();
  const slotRegex = /<slot\b([^>]*)>/g;

  for (const match of templateContent.matchAll(slotRegex)) {
    const attrs = match[1] ?? '';
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/);
    const name = nameMatch?.[1] ?? 'default';
    slots.set(name, name === 'default');
  }

  return [...slots.entries()]
    .map(([name, isDefault]) => ({ name, isDefault }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeSlotLists(...slotLists: RawSlotDefinition[][]): RawSlotDefinition[] {
  const merged = new Map<string, RawSlotDefinition>();

  for (const slotList of slotLists) {
    for (const slot of slotList) {
      const existing = merged.get(slot.name);
      if (!existing) {
        merged.set(slot.name, slot);
        continue;
      }

      merged.set(slot.name, {
        ...existing,
        ...slot,
        description: existing.description ?? slot.description,
      });
    }
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
