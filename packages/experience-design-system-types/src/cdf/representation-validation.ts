import type { CDFComponentEntry, CDFValidationError } from './types.js';
import { contentDigest } from '../property-contract/content-digest.js';
import { childPath, cloneJson, jsonEqual, own } from '../property-contract/json-value.js';
import { validateRepresentationPlan } from '../property-contract/representation-plan.js';

/** Check saved plan integrity and exact physical closure independently of mapper availability. */
export function validateRepresentationClosure(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
): CDFValidationError[] {
  const errors: CDFValidationError[] = [];
  const entries = new Map(components.map((component) => [component.key, component.entry]));
  const claimed = new Set<string>();
  const owners = new Set<string>();
  if (entries.size !== components.length) errors.push({ path: '/', message: 'Duplicate complete component identity' });
  for (const { key, entry } of components) {
    for (const [property, plan] of Object.entries(entry.$representationPlans ?? {})) {
      const path = childPath(childPath(childPath('', key), '$representationPlans'), property);
      const fail = (message: string): void => {
        errors.push({ path, message });
      };
      try {
        for (const issue of validateRepresentationPlan(plan, plan.sourceModel, plan.contextSnapshot))
          fail(issue.message);
        if (owners.has(plan.identity.propertyId)) fail('Duplicate representation source owner');
        owners.add(plan.identity.propertyId);
        const input = cloneJson(plan);
        const { id: _id, ...unsigned } = input;
        for (const generated of unsigned.models) {
          delete generated.entry.$model;
          for (const slot of Object.values(generated.entry.$slots ?? {}))
            if (slot.$modelBinding) slot.$modelBinding.planId = '';
        }
        if (unsigned.attachment?.definition.$modelBinding) unsigned.attachment.definition.$modelBinding.planId = '';
        if (contentDigest(unsigned) !== plan.id) fail('Stale or altered representation plan identity');
        if (
          plan.identity.key !== property ||
          plan.identity.propertyId !== JSON.stringify([plan.identity.componentId, property])
        )
          fail('Representation property owner disagrees');
        const graph = plan.logicalGraph;
        const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
        const mappings = new Map(plan.mappings.map((mapping) => [mapping.nodeId, mapping]));
        if (
          graph.authority !== 'compiler' ||
          graph.rootId !== plan.identity.nodeId ||
          !nodes.has(graph.rootId) ||
          nodes.size !== graph.nodes.length ||
          mappings.size !== plan.mappings.length ||
          mappings.size !== nodes.size
        )
          fail('Incomplete or duplicate logical source accounting');
        const reached = new Set<string>();
        const pending = [graph.rootId];
        while (pending.length) {
          const nodeId = pending.pop()!;
          if (reached.has(nodeId)) continue;
          reached.add(nodeId);
          const node = nodes.get(nodeId);
          if (!node) {
            fail('Dangling logical source relationship');
            continue;
          }
          const mapping = mappings.get(nodeId);
          if (
            !mapping ||
            mapping.sourceNodeId !== node.sourceNodeId ||
            !jsonEqual(mapping.path, node.path) ||
            mapping.required !== node.required ||
            mapping.readonly !== node.readonly ||
            mapping.occurrenceReadonly !== node.occurrenceReadonly ||
            mapping.intrinsicReadonly !== node.intrinsicReadonly ||
            mapping.nullable !== (node.nullable ?? null) ||
            mapping.undefinable !== (node.undefinable ?? null) ||
            !jsonEqual(mapping.defaultIntent, node.defaultIntent)
          )
            fail('Mapping changes retained source occurrence evidence');
          if (mapping?.targetNodeId && !nodes.has(mapping.targetNodeId)) fail('Dangling source mapping target');
          pending.push(
            ...(node.fields?.map((field) => field.nodeId) ?? []),
            ...(node.items ?? []),
            ...(node.alternatives ?? []),
            ...(node.indexSignatures?.map((signature) => signature.valueNodeId) ?? []),
          );
        }
        if (reached.size !== nodes.size) fail('Disconnected logical source accounting');
        if (
          plan.sdkValid &&
          (plan.issues.length ||
            plan.mappings.some((mapping) => mapping.disposition === 'held') ||
            graph.coverage !== 'complete-within-declared-bound')
        )
          fail('Representation validity contradicts held source evidence');
        if (plan.kind === 'native') {
          if (plan.models.length || plan.attachment || !jsonEqual(entry.$properties[property], plan.nativeDefinition))
            fail('Native representation disagrees with the complete component');
        } else if (
          !plan.attachment ||
          own(entry.$properties, property) ||
          !jsonEqual(entry.$slots?.[plan.attachment.slot], plan.attachment.definition)
        )
          fail('Model attachment disagrees with the complete component');
        const models = new Map(plan.models.map((generated) => [generated.key, generated]));
        if (models.size !== plan.models.length) fail('Duplicate representation model identity');
        for (const generated of plan.models) {
          const binding = generated.entry.$model;
          if (
            !binding ||
            binding.planId !== plan.id ||
            binding.componentId !== plan.identity.componentId ||
            binding.propertyId !== plan.identity.propertyId ||
            binding.nodeId !== generated.nodeId ||
            binding.sourceNodeId !== nodes.get(generated.nodeId)?.sourceNodeId
          )
            fail('Model source owner disagrees');
          if (!jsonEqual(entries.get(generated.key), generated.entry))
            fail('Missing or altered representation model definition');
          if (claimed.has(generated.key)) fail('Duplicate representation model owner');
          claimed.add(generated.key);
          for (const slot of Object.values(generated.entry.$slots ?? {})) {
            const owner = slot.$modelBinding;
            if (
              !owner ||
              owner.planId !== plan.id ||
              owner.componentId !== plan.identity.componentId ||
              owner.propertyId !== plan.identity.propertyId ||
              owner.sourceNodeId !== nodes.get(owner.nodeId)?.sourceNodeId ||
              (slot.$allowedComponents ?? []).some((allowed) => !models.has(allowed))
            )
              fail('Model relationship changes source ownership or closure');
          }
        }
        const physical = new Set<string>();
        const dependencies = [...(plan.attachment?.definition.$allowedComponents ?? [])];
        while (dependencies.length) {
          const modelKey = dependencies.pop()!;
          if (physical.has(modelKey)) continue;
          physical.add(modelKey);
          const generated = models.get(modelKey);
          if (!generated) {
            fail('Missing representation dependency');
            continue;
          }
          for (const slot of Object.values(generated.entry.$slots ?? {}))
            dependencies.push(...(slot.$allowedComponents ?? []));
        }
        if (physical.size !== models.size) fail('Orphan representation dependency');
      } catch {
        fail('Malformed complete representation metadata');
      }
    }
  }
  for (const { key, entry } of components)
    if (entry.$model && !claimed.has(key))
      errors.push({ path: childPath('', key), message: 'Model definition has no complete source owner' });
  return errors;
}
