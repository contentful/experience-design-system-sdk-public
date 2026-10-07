import type { RawComponentDefinition, RawSlotDefinition } from '@contentful/experience-design-system-extraction';
import type { CompositionEdge } from './interchange-schema.js';

export type ApplyMappingResult = {
  components: RawComponentDefinition[];
  warnings: string[];
};

export function applyMapping(components: RawComponentDefinition[], edges: CompositionEdge[]): ApplyMappingResult {
  const warnings: string[] = [];
  const names = new Set(components.map((c) => c.name));

  const cloned: RawComponentDefinition[] = components.map((c) => ({
    ...c,
    slots: c.slots.map((s) => ({
      ...s,
      ...(s.allowedComponents ? { allowedComponents: [...s.allowedComponents] } : {}),
    })),
  }));
  const byName = new Map(cloned.map((c) => [c.name, c]));

  const isHighTrust = (p: CompositionEdge['provenance']): boolean => p === 'typed-slot' || p.startsWith('adapter:');

  const addAllowed = (slot: RawSlotDefinition, child: string): void => {
    const set = new Set(slot.allowedComponents ?? []);
    set.add(child);
    slot.allowedComponents = [...set];
  };

  for (const edge of edges) {
    if (!names.has(edge.parent)) {
      warnings.push(`dropped edge: unknown parent "${edge.parent}" (${edge.parent}→${edge.child})`);
      continue;
    }
    if (!names.has(edge.child)) {
      warnings.push(`dropped edge: unknown child "${edge.child}" (${edge.parent}→${edge.child})`);
      continue;
    }
    const parent = byName.get(edge.parent)!;

    if (edge.slot) {
      const named = parent.slots.find((s) => s.name === edge.slot);
      if (named) {
        addAllowed(named, edge.child);
        continue;
      }
      if (isHighTrust(edge.provenance)) {
        const synthesized: RawSlotDefinition = { name: edge.slot, isDefault: false, allowedComponents: [edge.child] };
        parent.slots.push(synthesized);
        continue;
      }
      warnings.push(
        `dropped edge: slot "${edge.slot}" not found on "${edge.parent}" (agent-provenance; ${edge.parent}→${edge.child})`,
      );
      continue;
    }

    let def = parent.slots.find((s) => s.isDefault);
    if (!def) {
      def = { name: 'children', isDefault: true, allowedComponents: [] };
      parent.slots.push(def);
    }
    addAllowed(def, edge.child);
  }

  return { components: cloned, warnings };
}
