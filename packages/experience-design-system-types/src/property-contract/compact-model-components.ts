import type { CDFComponentEntry, CDFSlotDefinition } from '../cdf/types.js';
import type { LogicalSourceNode } from './logical-source-graph.js';
import type { LogicalPhysicalMapping, ModelCardinality, ModelReconstruction } from './representation-plan.js';
import { cloneJson } from './json-value.js';

interface GeneratedModel {
  key: string;
  nodeId: string;
  entry: CDFComponentEntry;
}

interface Wrapper {
  childKey: string;
  slot: CDFSlotDefinition;
  reconstruction: ModelReconstruction;
}

/** Compact physical authoring scaffolding while retaining every logical source node. */
export function compactModelComponents({
  nodes,
  models,
  mappings,
  attachment,
}: {
  nodes: ReadonlyMap<string, LogicalSourceNode>;
  models: Map<string, GeneratedModel>;
  mappings: Map<string, LogicalPhysicalMapping>;
  attachment: CDFSlotDefinition;
}): void {
  const wrappers = new Map<string, Wrapper>();
  for (const model of models.values()) {
    const node = nodes.get(model.nodeId)!;
    const slots = Object.entries(model.entry.$slots ?? {});
    if (Object.keys(model.entry.$properties).length || slots.length !== 1 || node.branchConditions?.length) continue;
    const [name, slot] = slots[0]!;
    if (slot.$allowedComponents?.length !== 1 || !slot.$cardinality) continue;
    const childKey = slot.$allowedComponents[0]!;
    const childNodeId = slot.$modelBinding?.nodeId;
    if (!childNodeId) continue;
    let reconstruction: ModelReconstruction | undefined;
    if (node.kind === 'union' && !node.unionBranches && name === 'value') {
      const alternatives = node.alternatives ?? [];
      const values = alternatives.filter((id) => !['null', 'undefined', 'never'].includes(nodes.get(id)!.kind));
      if (values.length === 1 && values[0] === childNodeId)
        reconstruction = { kind: 'optional-value', valueNodeId: childNodeId };
    } else if (
      node.kind === 'record' &&
      node.fields?.length === 1 &&
      !node.indexSignatures?.length &&
      !node.callSignatures?.length &&
      node.fields[0]!.key === name &&
      node.fields[0]!.nodeId === childNodeId
    )
      reconstruction = { kind: 'object-envelope', field: name, valueNodeId: childNodeId };
    else if (node.kind === 'array' && node.items?.length === 1 && name === 'items' && node.items[0] === childNodeId)
      reconstruction = { kind: 'ordered-array', itemNodeId: childNodeId };
    if (reconstruction) wrappers.set(model.key, { childKey, slot, reconstruction });
  }

  const repeated = new Set<string>();
  for (const model of models.values())
    for (const slot of Object.values(model.entry.$slots ?? {}))
      if (slot.$cardinality?.max !== 1) for (const key of slot.$allowedComponents ?? []) repeated.add(key);
  // Transparent envelopes inherit their incoming element boundary; nested collections retain theirs.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, wrapper] of wrappers)
      if (repeated.has(key) && wrapper.reconstruction.kind !== 'ordered-array' && !repeated.has(wrapper.childKey)) {
        repeated.add(wrapper.childKey);
        changed = true;
      }
  }
  for (const [key, wrapper] of wrappers)
    if (
      repeated.has(key) &&
      (wrapper.reconstruction.kind !== 'object-envelope' || wrapper.slot.$cardinality!.min === 0)
    )
      wrappers.delete(key);

  // A recursive chain of envelopes describes actual nesting, so it needs an instance boundary.
  for (const key of [...wrappers.keys()]) {
    const visited = new Set<string>();
    let current = key;
    while (wrappers.has(current)) {
      if (visited.has(current)) {
        for (const member of visited) wrappers.delete(member);
        break;
      }
      visited.add(current);
      current = wrappers.get(current)!.childKey;
    }
  }

  const compactSlot = (slot: CDFSlotDefinition): void => {
    if (slot.$allowedComponents?.length !== 1 || !slot.$cardinality) return;
    let key = slot.$allowedComponents[0]!;
    let cardinality: ModelCardinality = cloneJson(slot.$cardinality);
    while (wrappers.has(key)) {
      const wrapper = wrappers.get(key)!;
      const child = wrapper.slot.$cardinality!;
      if (wrapper.reconstruction.kind === 'ordered-array')
        cardinality = { min: child.min, max: child.max, ordered: true };
      else if (!cardinality.ordered)
        cardinality = { ...cardinality, min: cardinality.min === 0 || child.min === 0 ? 0 : cardinality.min };
      key = wrapper.childKey;
    }
    slot.$allowedComponents = [key];
    slot.$cardinality = cardinality;
    slot.$required = cardinality.min > 0;
  };
  compactSlot(attachment);
  for (const model of models.values())
    if (!wrappers.has(model.key)) for (const slot of Object.values(model.entry.$slots ?? {})) compactSlot(slot);

  for (const [key, wrapper] of wrappers) {
    const model = models.get(key)!;
    const mapping = mappings.get(model.nodeId)!;
    delete mapping.componentKey;
    delete mapping.slot;
    mapping.disposition = 'reconstruction';
    mapping.reconstruction = cloneJson(wrapper.reconstruction);
    if (wrapper.reconstruction.kind === 'optional-value')
      for (const id of nodes.get(model.nodeId)!.alternatives ?? []) {
        const node = nodes.get(id)!;
        if (!['null', 'undefined', 'never'].includes(node.kind)) continue;
        const empty = mappings.get(id)!;
        delete empty.componentKey;
        delete empty.slot;
        empty.disposition = 'reconstruction';
        empty.reconstruction = { kind: 'empty-value', state: node.kind as 'null' | 'undefined' | 'never' };
      }
    models.delete(key);
  }
}
