import { CDF_SCHEMA_URL } from '../cdf/schema.js';
import { validateCDF } from '../cdf/validate.js';
import {
  CDFComponentSchema,
  type CDFComponentEntry,
  type CDFFieldDefinition,
  type CDFSlotDefinition,
} from '../cdf/types.js';
import { cdfToTarget } from '../cdf/property-validation.js';
import { childPath, jsonEqual, type PropertyIssue } from './json-value.js';
import { validateRepresentationPlan, type RepresentationPlan } from './representation-plan.js';

const DEFINITION_CAPABILITIES = new Set([
  'deployed-mapper',
  'component-model-mapper',
  'singleton-slot-cardinality',
  'ordered-slot-cardinality',
]);
const DEFERRED_RUNTIME_CAPABILITIES = new Set([
  'source-reconstruction',
  'source-default-evaluation',
  'source-structural-default-materialization',
  'empty-source-value-materialization',
  'presence-null-state',
  'exclusive-union-branch-selection',
  'intrinsic-field-reconstruction',
  'index-key-preservation:string',
  'index-key-preservation:number',
]);

/** Importing a definition does not establish delivery or rendering readiness. */
export function definitionImportCapabilityStatus(capability: string): 'supported' | 'deferred' | 'unavailable' {
  if (DEFINITION_CAPABILITIES.has(capability)) return 'supported';
  return DEFERRED_RUNTIME_CAPABILITIES.has(capability) ? 'deferred' : 'unavailable';
}

export function slotDefinitionImportIssues(slot: CDFSlotDefinition): string[] {
  const cardinality = slot.$cardinality;
  if (!cardinality) return [];
  if (cardinality.tuplePosition !== undefined || cardinality.rest !== undefined)
    return ['Slot cardinality mapping is not available for positional model semantics'];
  if (cardinality.max === 0) return ['Slot cardinality mapping is not available for empty-only slots'];
  if (!Number.isSafeInteger(cardinality.min) || (cardinality.max !== null && !Number.isSafeInteger(cardinality.max)))
    return ['Slot cardinality bounds must be safe integers'];
  return [];
}

/** Finite choices stay in the source; target mapping owns enforcement and loss reporting. */
export function propertyDefinitionImportBlockers(definition: CDFFieldDefinition, path = ''): string[] {
  return definition.$category === 'design' && !['String', 'Number', 'Boolean'].includes(cdfToTarget(definition).type)
    ? [`${path ? path + ': ' : ''}Structured design properties require a model representation`]
    : [];
}

export function representationDefinitionImportIssues(plan: RepresentationPlan): string[] {
  if (!['native', 'component-model'].includes(plan.kind) || !plan.sdkValid || !Array.isArray(plan.requirements))
    return ['Representation mapping prerequisites are not available'];
  return plan.requirements.flatMap((requirement) => {
    const allowed =
      plan.kind === 'native'
        ? requirement.capability === 'deployed-mapper'
        : definitionImportCapabilityStatus(requirement.capability) !== 'unavailable';
    return allowed ? [] : [`Required capability ${requirement.capability} remains unverified at ${requirement.path}`];
  });
}

/** Check source-owned definitions; the target API remains authoritative for physical schemas. */
export function componentDefinitionImportIssues(component: CDFComponentEntry): PropertyIssue[] {
  const issues: PropertyIssue[] = [];
  if (
    component.$model &&
    !CDFComponentSchema.safeParse(Object.fromEntries(Object.entries(component).filter(([key]) => key !== 'key')))
      .success
  )
    issues.push({ path: '/$model', message: 'Invalid model component source binding' });
  for (const [id, slot] of Object.entries(component.$slots ?? {}))
    for (const message of slotDefinitionImportIssues(slot))
      issues.push({ path: childPath('/$slots', id) + '/$cardinality', message });
  for (const [id, definition] of Object.entries(component.$properties))
    for (const message of propertyDefinitionImportBlockers(definition))
      issues.push({ path: childPath('/$properties', id), message });
  for (const [id, plan] of Object.entries(component.$representationPlans ?? {})) {
    const path = childPath('/$representationPlans', id);
    const prerequisites = representationDefinitionImportIssues(plan);
    if (prerequisites.length) {
      issues.push(...prerequisites.map((message) => ({ path, message })));
      continue;
    }
    try {
      issues.push(
        ...validateRepresentationPlan(plan, plan.sourceModel, plan.contextSnapshot).map(({ message }) => ({
          path,
          message,
        })),
      );
      if (
        plan.identity.key !== id ||
        (plan.kind === 'native'
          ? !Object.hasOwn(component.$properties, id) || !jsonEqual(plan.nativeDefinition, component.$properties[id])
          : !plan.attachment ||
            Object.hasOwn(component.$properties, id) ||
            !jsonEqual(component.$slots?.[plan.attachment.slot], plan.attachment.definition))
      )
        issues.push({ path, message: 'Representation does not match its physical definition' });
    } catch {
      issues.push({ path, message: 'Invalid representation plan' });
    }
  }
  return issues;
}

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
