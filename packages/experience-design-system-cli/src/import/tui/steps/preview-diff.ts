import type {
  ChangeClassification,
  ComponentTypeSummary,
  PropertySummary,
} from '@contentful/experience-design-system-types';

export interface PropertyDiffLine {
  key: string;
  color: 'green' | 'red' | 'yellow';
  text: string;
}

export function computeComponentDiffLines(
  current: ComponentTypeSummary,
  proposed: Record<string, unknown>,
  changeClassification?: ChangeClassification,
): PropertyDiffLine[] {
  const lines: PropertyDiffLine[] = [];
  // Use fullProperties keys as authoritative server state (includes state props, not just content+design)
  const currentProps = current.fullProperties
    ? new Set(Object.keys(current.fullProperties))
    : new Set([...current.contentProperties, ...current.designProperties]);
  const proposedProperties = (proposed['$properties'] ?? {}) as Record<string, Record<string, unknown>>;
  const proposedProps = new Set(Object.keys(proposedProperties));
  const oldProps = current.fullProperties;

  // Added props
  for (const name of [...proposedProps].sort()) {
    if (!currentProps.has(name)) {
      const def = proposedProperties[name]!;
      lines.push({ key: `${name}-add`, color: 'green', text: `+ ${name}: ${formatPropDef(def)}` });
    }
  }

  // Removed props
  for (const name of [...currentProps].sort()) {
    if (!proposedProps.has(name)) {
      if (oldProps?.[name]) {
        lines.push({ key: `${name}-rm`, color: 'red', text: `- ${name}: ${formatOldProp(oldProps[name])}` });
      } else {
        const cat = current.contentProperties.includes(name) ? 'content' : 'design';
        lines.push({ key: `${name}-rm`, color: 'red', text: `- ${name} (${cat})` });
      }
    }
  }

  // Modified props — compare old vs new definitions
  const handledProps = new Set<string>();
  for (const name of [...currentProps].sort()) {
    if (!proposedProps.has(name)) continue;
    const newDef = proposedProperties[name]!;
    const oldDef = oldProps?.[name];

    if (!oldDef) continue;

    const diffs = diffProperty(name, oldDef, newDef);
    if (diffs.length > 0) {
      handledProps.add(name);
      for (const d of diffs) lines.push(d);
    }
  }

  // If no old definitions available, fall back to breaking change reasons
  if (!oldProps && changeClassification?.breakingChanges) {
    for (const bc of changeClassification.breakingChanges) {
      if (!('propertyId' in bc)) continue;
      if (!currentProps.has(bc.propertyId) || !proposedProps.has(bc.propertyId)) continue;
      if (handledProps.has(bc.propertyId)) continue;
      handledProps.add(bc.propertyId);
      const def = proposedProperties[bc.propertyId]!;
      lines.push({ key: `${bc.propertyId}-old`, color: 'red', text: `- ${bc.propertyId}: ${bc.reason}` });
      lines.push({ key: `${bc.propertyId}-new`, color: 'green', text: `+ ${bc.propertyId}: ${formatPropDef(def)}` });
    }
  }

  // Slot diffs
  const currentSlots = new Set(current.slots);
  const proposedSlots = (proposed['$slots'] ?? {}) as Record<string, Record<string, unknown>>;
  const proposedSlotNames = new Set(Object.keys(proposedSlots));
  const currentSlotAllowed = current.currentSlotAllowed ?? {};
  for (const name of [...proposedSlotNames].sort()) {
    if (!currentSlots.has(name)) {
      lines.push({ key: `slot-${name}-add`, color: 'green', text: `+ slot: ${name}` });
    }
  }
  for (const name of [...currentSlots].sort()) {
    if (!proposedSlotNames.has(name)) {
      lines.push({ key: `slot-${name}-rm`, color: 'red', text: `- slot: ${name}` });
    }
  }

  // $allowedComponents diffs — for each slot present in both sides, or newly-added
  // with a non-empty allowedComponents list.
  for (const name of [...proposedSlotNames].sort()) {
    const nextAllowed = normalizeAllowedComponents(proposedSlots[name]?.['$allowedComponents']);
    const prevAllowed = normalizeAllowedComponents(currentSlotAllowed[name]);
    const prevExists = currentSlots.has(name);

    if (!prevExists) {
      if (nextAllowed.length > 0) {
        lines.push({
          key: `slot-${name}-allow-new`,
          color: 'green',
          text: `+ slot ${name} allowedComponents: [${nextAllowed.join(', ')}]`,
        });
      }
      continue;
    }

    if (arraysEqual(prevAllowed, nextAllowed)) continue;

    lines.push({
      key: `slot-${name}-allow-old`,
      color: 'red',
      text: `- slot ${name} allowedComponents: [${prevAllowed.join(', ')}]`,
    });
    lines.push({
      key: `slot-${name}-allow-new`,
      color: 'green',
      text: `+ slot ${name} allowedComponents: [${nextAllowed.join(', ')}]`,
    });
  }

  return lines;
}

function normalizeAllowedComponents(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) out.push(item);
  }
  return out.sort();
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function normalizeType(type: string): string {
  switch (type.toLowerCase()) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'symbol':
    case 'enum':
      return 'symbol';
    case 'string':
    case 'text':
    case 'richtext':
    case 'media':
      return 'string';
    default:
      return type.toLowerCase();
  }
}

export function diffProperty(name: string, old: PropertySummary, newDef: Record<string, unknown>): PropertyDiffLine[] {
  const diffs: PropertyDiffLine[] = [];
  const newType = (newDef['$type'] as string) ?? '';
  const newCategory = (newDef['$category'] as string) ?? '';
  const newRequired = newDef['$required'] === true;
  const newDefault = newDef['$default'];

  const typeChanged = old.type !== '' && newType !== '' && normalizeType(old.type) !== normalizeType(newType);
  const categoryChanged = old.category !== newCategory;
  const requiredChanged = old.required !== newRequired;
  const defaultChanged = JSON.stringify(old.default) !== JSON.stringify(newDefault);

  if (!typeChanged && !categoryChanged && !requiredChanged && !defaultChanged) return [];

  diffs.push({ key: `${name}-old`, color: 'red', text: `- ${name}: ${formatOldProp(old)}` });
  diffs.push({ key: `${name}-new`, color: 'green', text: `+ ${name}: ${formatPropDef(newDef)}` });
  return diffs;
}

export function formatOldProp(prop: PropertySummary): string {
  const parts: string[] = [];
  if (prop.type) parts.push(prop.type);
  if (prop.category) parts.push(prop.category);
  parts.push(prop.required ? 'required' : 'optional');
  if (prop.default !== undefined) parts.push(`default=${JSON.stringify(prop.default)}`);
  return parts.join(', ');
}

export function formatPropDef(def: Record<string, unknown>): string {
  const parts: string[] = [];
  if (def['$type']) parts.push(def['$type'] as string);
  if (def['$category']) parts.push(def['$category'] as string);
  if (def['$required'] === true) parts.push('required');
  else parts.push('optional');
  if (def['$default'] !== undefined) parts.push(`default=${JSON.stringify(def['$default'])}`);
  return parts.join(', ');
}
