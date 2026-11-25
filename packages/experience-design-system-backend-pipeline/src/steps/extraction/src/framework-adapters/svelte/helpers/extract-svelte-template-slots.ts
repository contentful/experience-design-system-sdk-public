import type { RawSlotDefinition } from '../../../types/component.js';
import type { AstNode } from '../types/svelte-ast-node.js';

export function extractTemplateSlots(fragment: AstNode): RawSlotDefinition[] {
  const slots = new Map<string, boolean>();
  const seen = new Set<string>();
  walk(fragment);
  return [...slots.entries()]
    .map(([name, isDefault]) => ({ name, isDefault }))
    .sort((a, b) => a.name.localeCompare(b.name));

  function walk(node: AstNode | undefined): void {
    if (!node) return;
    if (node.type === 'SlotElement') {
      const name = readSlotName(node);
      if (!seen.has(name)) {
        seen.add(name);
        slots.set(name, name === 'default');
      }
    }
    const children = (node['nodes'] as AstNode[] | undefined) ?? (node['children'] as AstNode[] | undefined) ?? [];
    for (const child of children) walk(child);
    const fragmentChild = node['fragment'] as AstNode | undefined;
    if (fragmentChild) walk(fragmentChild);
  }
}

function readSlotName(slotElement: AstNode): string {
  const attrs = (slotElement['attributes'] as AstNode[] | undefined) ?? [];
  for (const attr of attrs) {
    if (attr['name'] !== 'name') continue;
    const value = attr['value'] as AstNode[] | AstNode | undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item.type === 'Text' && typeof item['data'] === 'string') return item['data'] as string;
      }
    }
  }
  return 'default';
}

export function mergeSlots(
  fromTemplate: RawSlotDefinition[],
  fromSnippetProps: RawSlotDefinition[],
): { slots: RawSlotDefinition[]; mixedWarning: boolean } {
  if (fromTemplate.length === 0) return { slots: fromSnippetProps, mixedWarning: false };
  if (fromSnippetProps.length === 0) return { slots: fromTemplate, mixedWarning: false };

  const byName = new Map<string, RawSlotDefinition>();
  for (const slot of fromTemplate) byName.set(slot.name, slot);
  const templateHasDefault = fromTemplate.some((slot) => slot.isDefault);
  let mixed = false;
  for (const slot of fromSnippetProps) {
    if (slot.isDefault && templateHasDefault) {
      mixed = true;
      continue;
    }
    if (byName.has(slot.name)) {
      mixed = true;
      continue;
    }
    byName.set(slot.name, slot);
  }
  return { slots: [...byName.values()], mixedWarning: mixed };
}
