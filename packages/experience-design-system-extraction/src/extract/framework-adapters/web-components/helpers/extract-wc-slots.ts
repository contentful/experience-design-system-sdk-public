import { type ClassDeclaration } from 'ts-morph';
import type { RawSlotDefinition } from '../../../types/component.js';
import { collectJsDocSlotComments } from '../../shared/helpers/collect-jsdoc-slot-comments.js';

export { extractTemplateContent, extractFastTemplateSlots } from './extract-wc-template-content.js';

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

export function extractJsDocSlots(classDecl: ClassDeclaration): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];

  for (const comment of collectJsDocSlotComments(classDecl)) {
    let name = 'default';
    let description = comment;

    if (comment.startsWith('-')) {
      description = comment.slice(1).trim();
    } else {
      const match = comment.match(/^(\S+)\s*-\s*(.*)$/s);
      if (match) {
        name = match[1]!;
        description = match[2]!.trim();
      }
    }

    slots.push({
      name,
      isDefault: name === 'default',
      ...(description && { description }),
    });
  }

  return mergeSlotLists(slots);
}
