import { CDF_SCHEMA_URL } from '../cdf/schema.js';
import { validateCDF } from '../cdf/validate.js';
import type { CDFComponentEntry } from '../cdf/types.js';
import { childPath, jsonEqual, type PropertyIssue } from './json-value.js';
import { componentDefinitionImportIssues } from './definition-import-rules.js';
export * from './definition-import-rules.js';

/** Model slots require an exact plan owner even on an otherwise ordinary component. */
export function componentModelFamilyIssues(
  components: readonly { key: string; entry: CDFComponentEntry }[],
): PropertyIssue[] {
  if (
    !components.some(
      ({ entry }) =>
        entry.$model ||
        entry.$representationPlans ||
        Object.values(entry.$slots ?? {}).some((slot) => slot.$modelBinding),
    )
  )
    return [];
  if (new Set(components.map(({ key }) => key)).size !== components.length)
    return [{ path: '/', message: 'Duplicate complete component identity' }];
  const validation = validateCDF({
    $schema: CDF_SCHEMA_URL,
    ...Object.fromEntries(components.map(({ key, entry }) => [key, entry])),
  });
  if (!validation.valid) return validation.errors.map(({ path, message }) => ({ path, message }));
  const expectedSlots = new Map<string, unknown>();
  for (const { key, entry } of components)
    for (const plan of Object.values(entry.$representationPlans ?? {})) {
      if (plan.attachment) expectedSlots.set(JSON.stringify([key, plan.attachment.slot]), plan.attachment.definition);
      for (const generated of plan.models)
        for (const [name, slot] of Object.entries(generated.entry.$slots ?? {}))
          expectedSlots.set(JSON.stringify([generated.key, name]), slot);
    }
  const issues: PropertyIssue[] = [];
  for (const { key, entry } of components)
    for (const [name, slot] of Object.entries(entry.$slots ?? {}))
      if (slot.$modelBinding && !jsonEqual(slot, expectedSlots.get(JSON.stringify([key, name]))))
        issues.push({
          path: childPath(childPath('', key) + '/$slots', name),
          message: 'Model slot has no exact source-plan owner',
        });
  return issues;
}

/** Data-model relationships do not instantiate a composition tree. Keep ordinary edges intact. */
export function componentCompositionDefinitions<T extends { key: string; entry: CDFComponentEntry }>(
  components: readonly T[],
): T[] {
  if (
    !components.some(({ entry }) => Object.values(entry.$slots ?? {}).some((slot) => slot.$modelBinding)) ||
    componentModelFamilyIssues(components).length ||
    components.some(({ entry }) => componentDefinitionImportIssues(entry).length)
  )
    return [...components];
  return components.map((component) => ({
    ...component,
    entry: {
      ...component.entry,
      $slots: Object.fromEntries(
        Object.entries(component.entry.$slots ?? {}).filter(([, slot]) => !slot.$modelBinding),
      ),
    },
  }));
}
