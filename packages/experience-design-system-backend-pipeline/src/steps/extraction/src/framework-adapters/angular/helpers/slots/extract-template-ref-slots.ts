import type { RawPropDefinition, RawSlotDefinition } from '../../../../types/component.js';

/**
 * NG-ZORRO's `nzTitle: TemplateRef`, Carbon's `title: string | TemplateRef`,
 * PrimeNG dialog's various template inputs — these look like props but a
 * designer sees them as slots. Split them out of the props list.
 *
 *   - A prop with pure TemplateRef type → remove it, add a slot.
 *   - A prop with `string | TemplateRef<T>` union → keep the prop (it still
 *     accepts a plain string) AND add a slot. Designers get both affordances.
 *
 * Returns `{ props, slots }` where `props` is the filtered list and `slots`
 * contains only the newly derived template-ref slots.
 */
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
    // Pure TemplateRef<...> (optionally with | null / | undefined) → slot only
    const isPureTemplateRef = /^\s*TemplateRef<[^>]*>\s*(\|\s*(null|undefined)\s*)*$/.test(type);
    if (!isPureTemplateRef) {
      // Union with other types (string | TemplateRef) → keep prop AND emit slot
      nextProps.push(prop);
    }
    slots.push({ name: prop.name, isDefault: false });
  }

  return { props: nextProps, slots };
}
