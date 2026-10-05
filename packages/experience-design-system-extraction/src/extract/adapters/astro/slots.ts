import type { RawSlotDefinition } from '../../model/component.js';

/** Finds `<slot name="...">` tags in the Astro template section. */
export function extractSlotsFromTemplate(template: string): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];
  const seen = new Set<string>();
  const slotRegex = /<slot(?:\s+name=["']([^"']+)["'])?\s*\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = slotRegex.exec(template)) !== null) {
    const slotName = match[1] ?? 'default';
    if (!seen.has(slotName)) {
      seen.add(slotName);
      slots.push({ name: slotName, isDefault: slotName === 'default' });
    }
  }
  return slots;
}

/** Finds `Astro.slots.render('name')` calls in the frontmatter to detect programmatically-rendered slots. */
export function extractSlotsFromFrontmatter(frontmatter: string): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];
  const seen = new Set<string>();
  const slotRenderRegex = /Astro\.slots\.render\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = slotRenderRegex.exec(frontmatter)) !== null) {
    const slotName = match[1]!;
    if (!seen.has(slotName)) {
      seen.add(slotName);
      slots.push({ name: slotName, isDefault: slotName === 'default' });
    }
  }
  return slots;
}

/** Merges slot arrays, keeping the first occurrence of each name. */
export function mergeSlots(...slotGroups: RawSlotDefinition[][]): RawSlotDefinition[] {
  const merged: RawSlotDefinition[] = [];
  const seen = new Set<string>();
  for (const slots of slotGroups) {
    for (const slot of slots) {
      if (seen.has(slot.name)) continue;
      seen.add(slot.name);
      merged.push(slot);
    }
  }
  return merged;
}
