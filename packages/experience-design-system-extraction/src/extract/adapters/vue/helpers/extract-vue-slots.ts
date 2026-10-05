import type { RawSlotDefinition } from '../../../model/component.js';

// @vue/compiler-core NodeTypes enum values (stable since Vue 3.0)
const ELEMENT_TYPE = 1;
const ATTRIBUTE_TYPE = 6;

interface TemplateAttrNode {
  type: number;
  name?: string;
  value?: { content?: string };
}

interface TemplateAstNode {
  type: number;
  tag?: string;
  props?: TemplateAttrNode[];
  children?: (TemplateAstNode | unknown)[];
}

/** Walks the Vue template AST and collects all `<slot>` elements. */
export function extractSlotsFromVueTemplate(ast: TemplateAstNode): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];

  function walk(node: TemplateAstNode): void {
    if (node.type === ELEMENT_TYPE && node.tag === 'slot') {
      const nameProp = node.props?.find((p) => p.type === ATTRIBUTE_TYPE && p.name === 'name');
      const slotName = nameProp?.value?.content ?? 'default';
      if (!slots.some((s) => s.name === slotName)) {
        slots.push({ name: slotName, isDefault: slotName === 'default' });
      }
    }
    if (node.children) {
      for (const child of node.children) {
        if (typeof child === 'object' && child !== null && 'type' in child) {
          walk(child as TemplateAstNode);
        }
      }
    }
  }

  walk(ast);
  return slots;
}

/**
 * Detects slots referenced via `$slots.name` or `$slots['name']` in template or
 * script content that aren't declared as `<slot>` tags.
 */
export function collectRuntimeAccessSlots(source: string): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];
  const seen = new Set<string>();

  const dotPattern = /\$slots\.([a-zA-Z_]\w*)/g;
  const bracketPattern = /\$slots\[['"]([a-zA-Z_][\w-]*)['"]\]/g;

  for (const pattern of [dotPattern, bracketPattern]) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const name = match[1];
      if (!seen.has(name)) {
        seen.add(name);
        slots.push({ name, isDefault: name === 'default' });
      }
    }
  }

  return slots;
}

/** Merges two slot arrays, keeping the first occurrence of each slot name. */
export function mergeVueSlots(base: RawSlotDefinition[], extra: RawSlotDefinition[]): RawSlotDefinition[] {
  const merged = [...base];
  for (const slot of extra) {
    if (!merged.some((s) => s.name === slot.name)) {
      merged.push(slot);
    }
  }
  return merged;
}
