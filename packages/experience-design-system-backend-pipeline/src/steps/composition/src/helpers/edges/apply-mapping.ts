import type { RawComponentDefinition, RawSlotDefinition } from '../../../../extraction/src/types/component.js';
import type { CompositionEdge } from './interchange-schema.js';
import type { ApplyCompositionEdgesResult } from '../../types/contract.js';

function cloneComponents(components: RawComponentDefinition[]): RawComponentDefinition[] {
  return components.map((c) => ({
    ...c,
    slots: c.slots.map((s) => ({
      ...s,
      ...(s.allowedComponents ? { allowedComponents: [...s.allowedComponents] } : {}),
    })),
  }));
}

function isHighTrustProvenance(provenance: CompositionEdge['provenance']): boolean {
  return provenance === 'typed-slot' || provenance.startsWith('adapter:');
}

function addAllowedChild(slot: RawSlotDefinition, child: string): void {
  const set = new Set(slot.allowedComponents ?? []);
  set.add(child);
  slot.allowedComponents = [...set];
}

function findOrCreateDefaultSlot(parent: RawComponentDefinition): RawSlotDefinition {
  const existing = parent.slots.find((s) => s.isDefault);
  if (existing) return existing;
  const created: RawSlotDefinition = { name: 'children', isDefault: true, allowedComponents: [] };
  parent.slots.push(created);
  return created;
}

function resolveNamedSlotEdge(edge: CompositionEdge, parent: RawComponentDefinition, warnings: string[]): void {
  const named = parent.slots.find((s) => s.name === edge.slot);
  if (named) {
    addAllowedChild(named, edge.child);
    return;
  }
  if (isHighTrustProvenance(edge.provenance)) {
    parent.slots.push({ name: edge.slot!, isDefault: false, allowedComponents: [edge.child] });
    return;
  }
  warnings.push(
    `dropped edge: slot "${edge.slot}" not found on "${edge.parent}" (agent-provenance; ${edge.parent}→${edge.child})`,
  );
}

function resolveEdge(
  edge: CompositionEdge,
  byName: Map<string, RawComponentDefinition>,
  names: Set<string>,
  warnings: string[],
): void {
  if (!names.has(edge.parent)) {
    warnings.push(`dropped edge: unknown parent "${edge.parent}" (${edge.parent}→${edge.child})`);
    return;
  }
  if (!names.has(edge.child)) {
    warnings.push(`dropped edge: unknown child "${edge.child}" (${edge.parent}→${edge.child})`);
    return;
  }
  const parent = byName.get(edge.parent)!;
  if (edge.slot) {
    resolveNamedSlotEdge(edge, parent, warnings);
  } else {
    addAllowedChild(findOrCreateDefaultSlot(parent), edge.child);
  }
}

export function applyCompositionEdges(
  components: RawComponentDefinition[],
  edges: CompositionEdge[],
): ApplyCompositionEdgesResult {
  const warnings: string[] = [];
  const names = new Set(components.map((c) => c.name));
  const cloned = cloneComponents(components);
  const byName = new Map(cloned.map((c) => [c.name, c]));

  for (const edge of edges) {
    resolveEdge(edge, byName, names, warnings);
  }

  return { components: cloned, warnings };
}
