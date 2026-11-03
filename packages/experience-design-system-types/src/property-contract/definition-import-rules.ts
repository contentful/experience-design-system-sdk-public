import { CDFComponentSchema, type CDFComponentEntry, type CDFSlotDefinition } from '../cdf/types.js';
import { propertyDefinitionImportIssues } from './physical-property-import.js';
export * from './physical-property-import.js';
import { childPath, jsonEqual, type PropertyIssue } from './json-value.js';
import { validateRepresentationPlan, type ModelBinding, type RepresentationPlan } from './representation-plan.js';

const DEFINITION_CAPABILITIES = new Set([
  'deployed-mapper',
  'component-model-mapper',
  'singleton-slot-cardinality',
  'ordered-slot-cardinality',
  'cyclic-model-dependencies',
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

export function slotDefinitionImportIssues(slot: CDFSlotDefinition, modelOwner?: ModelBinding): string[] {
  const cardinality = slot.$cardinality;
  if (!cardinality) return [];
  const binding = slot.$modelBinding;
  const ownedModelSlot =
    modelOwner !== undefined &&
    binding !== undefined &&
    binding.planId === modelOwner.planId &&
    binding.componentId === modelOwner.componentId &&
    binding.propertyId === modelOwner.propertyId;
  // A source-owned model uses one typed slot per position; its family is checked separately.
  if ((cardinality.tuplePosition !== undefined || cardinality.rest !== undefined) && !ownedModelSlot)
    return ['Slot cardinality mapping is not available for positional model semantics'];
  if (cardinality.max === 0) return ['Slot cardinality mapping is not available for empty-only slots'];
  if (!Number.isSafeInteger(cardinality.min) || (cardinality.max !== null && !Number.isSafeInteger(cardinality.max)))
    return ['Slot cardinality bounds must be safe integers'];
  return [];
}

export function representationDefinitionImportIssues(plan: RepresentationPlan): string[] {
  if (!['native', 'component-model'].includes(plan.kind) || !plan.sdkValid || !Array.isArray(plan.requirements))
    return ['Representation mapping prerequisites are not available'];
  const issues = plan.requirements.flatMap((requirement) => {
    const allowed =
      plan.kind === 'native'
        ? requirement.capability === 'deployed-mapper'
        : definitionImportCapabilityStatus(requirement.capability) !== 'unavailable';
    return allowed ? [] : [`Required capability ${requirement.capability} remains unverified at ${requirement.path}`];
  });
  if (plan.kind === 'native' && plan.nativeDefinition)
    issues.push(
      ...propertyDefinitionImportIssues(plan.nativeDefinition).map(({ path, message }) => `${path}: ${message}`),
    );
  for (const model of plan.models)
    issues.push(
      ...componentDefinitionImportIssues(model.entry).map(({ path, message }) => `${model.key}${path}: ${message}`),
    );
  return issues;
}

/** Check source ownership and physical import constraints before mapping. */
export function componentDefinitionImportIssues(component: CDFComponentEntry): PropertyIssue[] {
  const issues: PropertyIssue[] = [];
  if (
    component.$model &&
    !CDFComponentSchema.safeParse(Object.fromEntries(Object.entries(component).filter(([key]) => key !== 'key')))
      .success
  )
    issues.push({ path: '/$model', message: 'Invalid model component source binding' });
  for (const [id, slot] of Object.entries(component.$slots ?? {})) {
    if (!id.trim() || !(id.split('.').at(-1) ?? id).split(/[-_]/g).filter(Boolean).join(' ').length)
      issues.push({ path: childPath('/$slots', id), message: 'Slot id must produce a non-empty display name' });
    for (const message of slotDefinitionImportIssues(slot, component.$model))
      issues.push({ path: childPath('/$slots', id) + '/$cardinality', message });
  }
  for (const [id, definition] of Object.entries(component.$properties))
    for (const issue of propertyDefinitionImportIssues(definition))
      issues.push({ path: childPath('/$properties', id) + issue.path, message: issue.message });
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
