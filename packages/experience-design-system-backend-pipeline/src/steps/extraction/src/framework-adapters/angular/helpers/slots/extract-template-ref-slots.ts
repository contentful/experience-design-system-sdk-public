import type { RawPropDefinition, RawSlotDefinition } from '../../../../types/component.js';

export function extractTemplateRefSlots(props: RawPropDefinition[]): {
  props: RawPropDefinition[];
  slots: RawSlotDefinition[];
} {
  const nextProps: RawPropDefinition[] = [];
  const slots: RawSlotDefinition[] = [];

  for (const prop of props) {
    const type = prop.type;
    const hasTemplateRef = /\bTemplateRef\b/.test(type);
    if (!hasTemplateRef) {
      nextProps.push(prop);
      continue;
    }

    const isPureTemplateRef = /^\s*TemplateRef<[^>]*>\s*(\|\s*(null|undefined)\s*)*$/.test(type);
    if (!isPureTemplateRef) {
      nextProps.push(prop);
    }
    slots.push({ name: prop.name, isDefault: false });
  }

  return { props: nextProps, slots };
}
