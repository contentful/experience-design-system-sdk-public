import { CDFComponentSchema, jsonEqual, type CDFFieldDefinition } from '@contentful/experience-design-system-types';
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
  const definition = record(proposed.definition) ?? proposed;
  // Use fullProperties keys as authoritative server state (includes state props, not just content+design)
  const currentProps = current.fullProperties
    ? new Set(Object.keys(current.fullProperties))
    : new Set([...current.contentProperties, ...current.designProperties]);
  const knownProperties = record(definition['$properties']);
  const proposedProperties = (knownProperties ?? {}) as Record<string, Record<string, unknown>>;
  if (!knownProperties && currentProps.size > 0)
    lines.push({ key: 'properties-unknown', color: 'yellow', text: '? proposed properties unknown' });
  const proposedProps = new Set(Object.keys(proposedProperties));
  const oldProps = current.fullProperties;

  for (const name of [...proposedProps].sort()) {
    if (!currentProps.has(name)) {
      const def = proposedProperties[name]!;
      lines.push({ key: `${name}-add`, color: 'green', text: `+ ${name}: ${formatPropDef(def)}` });
    }
  }

  for (const name of [...currentProps].sort()) {
    if (knownProperties && !proposedProps.has(name)) {
      if (oldProps?.[name]) {
        lines.push({ key: `${name}-rm`, color: 'red', text: `- ${name}: ${formatOldProp(oldProps[name])}` });
      } else {
        const cat = current.contentProperties.includes(name) ? 'content' : 'design';
        lines.push({ key: `${name}-rm`, color: 'red', text: `- ${name} (${cat})` });
      }
    }
  }

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

  const currentSlots = new Set(current.slots);
  const knownSlots =
    record(definition['$slots']) ?? (CDFComponentSchema.safeParse(definition).success ? {} : undefined);
  const proposedSlots = (knownSlots ?? {}) as Record<string, Record<string, unknown>>;
  if (!knownSlots && currentSlots.size > 0)
    lines.push({ key: 'slots-unknown', color: 'yellow', text: '? proposed slots unknown' });
  const proposedSlotNames = new Set(Object.keys(proposedSlots));
  const currentSlotAllowed = current.currentSlotAllowed ?? {};
  for (const name of [...proposedSlotNames].sort()) {
    if (!currentSlots.has(name)) {
      const required = proposedSlots[name]?.['$required'] === true ? ' (required)' : '';
      lines.push({ key: `slot-${name}-add`, color: 'green', text: `+ slot: ${name}${required}` });
    }
  }
  for (const name of [...currentSlots].sort()) {
    if (knownSlots && !proposedSlotNames.has(name)) {
      lines.push({ key: `slot-${name}-rm`, color: 'red', text: `- slot: ${name}` });
    }
  }

  for (const name of [...proposedSlotNames].sort()) {
    if (currentSlots.has(name)) {
      const summary = current.fullSlots && Object.hasOwn(current.fullSlots, name) ? current.fullSlots[name] : undefined;
      const previousRequired = summary?.required ?? summary?.definition?.$required;
      const nextRequired = proposedSlots[name]?.['$required'] === true;
      if (previousRequired === undefined) {
        if (nextRequired)
          lines.push({
            key: `slot-${name}-required-unknown`,
            color: 'yellow',
            text: `? slot ${name}: existing requiredness unknown; proposed required`,
          });
      } else if (previousRequired !== nextRequired) {
        lines.push({
          key: `slot-${name}-required-old`,
          color: 'red',
          text: `- slot ${name}: ${previousRequired ? 'required' : 'optional'}`,
        });
        lines.push({
          key: `slot-${name}-required-new`,
          color: 'green',
          text: `+ slot ${name}: ${nextRequired ? 'required' : 'optional'}`,
        });
      }
    }
    const nextAllowed = normalizeAllowedComponents(proposedSlots[name]?.['$allowedComponents']);
    const summary = current.fullSlots && Object.hasOwn(current.fullSlots, name) ? current.fullSlots[name] : undefined;
    const knownAllowed =
      Object.hasOwn(currentSlotAllowed, name) ||
      summary?.definition !== undefined ||
      (summary !== undefined && Object.hasOwn(summary, 'allowedComponents'));
    const prevAllowed = normalizeAllowedComponents(
      Object.hasOwn(currentSlotAllowed, name)
        ? currentSlotAllowed[name]
        : (summary?.allowedComponents ?? summary?.definition?.$allowedComponents),
    );
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

    if (!knownAllowed) {
      if (nextAllowed.length > 0)
        lines.push({
          key: `slot-${name}-allow-unknown`,
          color: 'yellow',
          text: `? slot ${name}: existing allowedComponents unknown`,
        });
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

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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

function diffProperty(name: string, old: PropertySummary, newDef: Record<string, unknown>): PropertyDiffLine[] {
  const diffs: PropertyDiffLine[] = [];
  const newType = (newDef['$type'] as string) ?? '';
  const newCategory = (newDef['$category'] as string) ?? '';
  const newRequired = newDef['$required'] === true;
  const newDefault = newDef['$default'];

  const typeChanged = old.type !== '' && newType !== '' && normalizeType(old.type) !== normalizeType(newType);
  const categoryChanged = old.category !== newCategory;
  const requiredChanged = old.required !== newRequired;
  const defaultChanged = !jsonEqual(old.default, newDefault);
  const structural = (definition: CDFFieldDefinition | Record<string, unknown>) => ({
    type: normalizeType(String(definition.$type)),
    items: definition.$items,
    fields: definition.$fields,
    values: definition.$values,
  });
  const hasNewStructure =
    newDef['$items'] !== undefined || newDef['$fields'] !== undefined || newDef['$values'] !== undefined;
  const structureUnknown = hasNewStructure && old.definition === undefined;
  const structureChanged = old.definition !== undefined && !jsonEqual(structural(old.definition), structural(newDef));
  if (structureUnknown)
    diffs.push({ key: `${name}-shape-unknown`, color: 'yellow', text: `? ${name}: existing recursive shape unknown` });

  if (!typeChanged && !categoryChanged && !requiredChanged && !defaultChanged && !structureChanged) return diffs;

  diffs.push({ key: `${name}-old`, color: 'red', text: `- ${name}: ${formatOldProp(old)}` });
  diffs.push({ key: `${name}-new`, color: 'green', text: `+ ${name}: ${formatPropDef(newDef)}` });
  return diffs;
}

function formatOldProp(prop: PropertySummary): string {
  const parts: string[] = [];
  if (prop.type) parts.push(prop.type);
  if (prop.category) parts.push(prop.category);
  parts.push(prop.required ? 'required' : 'optional');
  if (prop.default !== undefined) parts.push(`default=${JSON.stringify(prop.default)}`);
  return parts.join(', ');
}

function formatPropDef(def: Record<string, unknown>): string {
  const parts: string[] = [];
  if (def['$type']) parts.push(def['$type'] as string);
  if (def['$category']) parts.push(def['$category'] as string);
  if (def['$required'] === true) parts.push('required');
  else parts.push('optional');
  if (def['$default'] !== undefined) parts.push(`default=${JSON.stringify(def['$default'])}`);
  return parts.join(', ');
}
