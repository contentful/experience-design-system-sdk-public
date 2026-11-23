import type { ModelBinding } from '../property-contract/representation-plan.js';
import { childPath } from '../property-contract/json-value.js';
import type { CDFComponentEntry, CDFSlotDefinition, CDFValidationError } from './types.js';

export const modelBindingFamily = (binding: ModelBinding): string =>
  JSON.stringify([binding.planId, binding.componentId, binding.propertyId]);

export function validateModelBindings(
  components: readonly { key: string; entry: CDFComponentEntry }[],
): CDFValidationError[] {
  const errors: CDFValidationError[] = [];
  const entries = new Map(components.map(({ key, entry }) => [key, entry]));
  const families = new Map<
    string,
    { models: Set<string>; attachments: Array<{ path: string; definition: CDFSlotDefinition }> }
  >();
  const family = (binding: ModelBinding) => {
    const id = modelBindingFamily(binding);
    let result = families.get(id);
    if (!result) {
      result = { models: new Set(), attachments: [] };
      families.set(id, result);
    }
    return result;
  };
  const checkBinding = (binding: ModelBinding, path: string): void => {
    if (![binding.planId, binding.componentId, binding.propertyId, binding.nodeId].every((id) => id.trim()))
      errors.push({ path, message: 'Model binding identities must not be empty' });
  };
  for (const { key, entry } of components) {
    if (entry.$model) {
      checkBinding(entry.$model, childPath(childPath('', key), '$model'));
      family(entry.$model).models.add(key);
    }
    const positions = new Set<number>();
    for (const [name, slot] of Object.entries(entry.$slots ?? {})) {
      const path = childPath(childPath(childPath('', key), '$slots'), name);
      const binding = slot.$modelBinding;
      if (!binding) {
        if (entry.$model) errors.push({ path, message: 'Model slot requires a model binding' });
        continue;
      }
      checkBinding(binding, childPath(path, '$modelBinding'));
      if (entry.$model) {
        if (modelBindingFamily(entry.$model) !== modelBindingFamily(binding))
          errors.push({ path, message: 'Model slot binding disagrees with its component family' });
      } else family(binding).attachments.push({ path, definition: slot });
      for (const allowed of slot.$allowedComponents ?? []) {
        const target = entries.get(allowed)?.$model;
        if (!target || modelBindingFamily(target) !== modelBindingFamily(binding))
          errors.push({ path, message: 'Missing or cross-family model dependency' });
      }
      const position = slot.$cardinality?.tuplePosition;
      if (position !== undefined) {
        if (positions.has(position)) errors.push({ path, message: 'Duplicate model tuple position' });
        positions.add(position);
      }
    }
    if ([...positions].sort((left, right) => left - right).some((position, index) => position !== index))
      errors.push({
        path: childPath(childPath('', key), '$slots'),
        message: 'Model tuple positions must be contiguous',
      });
  }
  for (const { models, attachments } of families.values()) {
    if (attachments.length !== 1) {
      errors.push({
        path: attachments[0]?.path ?? childPath('', [...models][0] ?? ''),
        message: 'Model family requires exactly one owner attachment',
      });
      continue;
    }
    const attachment = attachments[0]!;
    const reached = new Set<string>();
    const pending = [...(attachment.definition.$allowedComponents ?? [])];
    while (pending.length) {
      const key = pending.pop()!;
      if (reached.has(key) || !models.has(key)) continue;
      reached.add(key);
      for (const slot of Object.values(entries.get(key)!.$slots ?? {}))
        pending.push(...(slot.$allowedComponents ?? []));
    }
    if (!models.size || reached.size !== models.size)
      errors.push({ path: attachment.path, message: 'Model family contains missing or unreachable definitions' });
  }
  return errors;
}
