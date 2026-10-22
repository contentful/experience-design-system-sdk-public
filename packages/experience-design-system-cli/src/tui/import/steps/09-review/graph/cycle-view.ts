import type { SlotCycle } from '../../07-scope-gate/graph/cycle-detection.js';
import { findSlotCycles } from '../../07-scope-gate/graph/cycle-detection.js';
import { buildComponentGraph, type SlotGraphInput } from '../../07-scope-gate/graph/slot-graph.js';
import { jsonEqual, validateRepresentationPlan } from '@contentful/experience-design-system-types';

/** Only bindings belonging to a validated selected plan are data-model edges. */
export function buildVisualComponentGraph(components: SlotGraphInput[]) {
  const modelSlots = new Map<string, NonNullable<SlotGraphInput['entry']['$slots']>>();
  for (const owner of components)
    for (const plan of Object.values(owner.entry.$representationPlans ?? {})) {
      if (
        plan.kind !== 'component-model' ||
        validateRepresentationPlan(plan, plan.sourceModel, plan.contextSnapshot).length
      )
        continue;
      if (plan.attachment) {
        const slots = modelSlots.get(owner.key) ?? {};
        slots[plan.attachment.slot] = plan.attachment.definition;
        modelSlots.set(owner.key, slots);
      }
      for (const model of plan.models) {
        const current = components.find((row) => row.key === model.key);
        if (current && jsonEqual(current.entry.$model, model.entry.$model))
          modelSlots.set(model.key, model.entry.$slots ?? {});
      }
    }
  return buildComponentGraph(
    components.map((row) => ({
      ...row,
      entry: {
        ...row.entry,
        $slots: Object.fromEntries(
          Object.entries(row.entry.$slots ?? {}).filter(
            ([name, slot]) => !jsonEqual(slot, modelSlots.get(row.key)?.[name]),
          ),
        ),
      },
    })),
  );
}

export interface CycleView {
  pushBlocking: SlotCycle[];
  structural: Set<string>;
  error?: string;
}

export function computeCycleView(components: SlotGraphInput[]): CycleView {
  const rejected = new Set(components.filter((row) => row.status === 'rejected').map((row) => row.key));

  let pushBlocking: SlotCycle[] = [];
  const structural = new Set<string>();

  try {
    const visualGraph = buildVisualComponentGraph(components);
    pushBlocking = findSlotCycles(visualGraph.filter((row) => !rejected.has(row.name)));
    for (const cyc of pushBlocking) for (const p of cyc.path) structural.add(p);
    const unfilteredCycles = findSlotCycles(visualGraph);
    for (const cyc of unfilteredCycles) for (const p of cyc.path) structural.add(p);
  } catch (error) {
    return {
      pushBlocking,
      structural,
      error: `Cannot verify component cycles: ${String(error)}. Fix the definitions and retry.`,
    };
  }

  return { pushBlocking, structural };
}
