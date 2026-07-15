import type { RawComponentDefinition, RawSlotDefinition } from '../../types.js';
import type { CompositionEdge } from './interchange-schema.js';

export type ApplyMappingResult = {
  components: RawComponentDefinition[];
  warnings: string[];
};

/**
 * Enrichment pass (spec T7): merge a resolved composition edge list into the
 * extracted components' `allowedComponents`. Runs AFTER extraction; it is the
 * mapping resolver's entire job — populating the one field every downstream
 * graph consumer reads.
 *
 * Slot targeting:
 *  - edge.slot present + slot exists → write there.
 *  - edge.slot present + slot missing → synthesize for high-trust
 *    (typed-slot / adapter) edges; drop-and-warn for `agent` edges.
 *  - edge.slot absent → default slot (isDefault), synthesized if none exists.
 *
 * Edges naming unknown parents/children are dropped-and-warned (§1.3). Inputs
 * are not mutated; a deep-enough clone of touched slots is returned.
 */
export function applyMapping(components: RawComponentDefinition[], edges: CompositionEdge[]): ApplyMappingResult {
  const warnings: string[] = [];
  const names = new Set(components.map((c) => c.name));

  // Clone components (and their slots) so inputs stay untouched.
  const cloned: RawComponentDefinition[] = components.map((c) => ({
    ...c,
    slots: c.slots.map((s) => ({
      ...s,
      ...(s.allowedComponents ? { allowedComponents: [...s.allowedComponents] } : {}),
    })),
  }));
  const byName = new Map(cloned.map((c) => [c.name, c]));

  const isHighTrust = (p: CompositionEdge['provenance']): boolean =>
    p === 'user' || p === 'typed-slot' || p.startsWith('adapter:');

  const addAllowed = (slot: RawSlotDefinition, child: string): void => {
    const set = new Set(slot.allowedComponents ?? []);
    set.add(child);
    slot.allowedComponents = [...set];
  };

  for (const edge of edges) {
    if (!names.has(edge.parent)) {
      warnings.push(`dropped edge: unknown parent component "${edge.parent}" (${edge.parent}→${edge.child})`);
      continue;
    }
    if (!names.has(edge.child)) {
      warnings.push(`dropped edge: unknown child component "${edge.child}" (${edge.parent}→${edge.child})`);
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

    // Default slot.
    let def = parent.slots.find((s) => s.isDefault);
    if (!def) {
      def = { name: 'children', isDefault: true, allowedComponents: [] };
      parent.slots.push(def);
    }
    addAllowed(def, edge.child);
  }

  return { components: cloned, warnings };
}
