import type { ComponentGraphInput, ComponentGraphNode } from '../../types/graph.js';

const REJECTED_STATUSES = new Set<string>(['error', 'rejected']);

export function buildComponentGraph(
  components: ComponentGraphInput[],
  opts?: { stripRejectedEdges?: boolean },
): ComponentGraphNode[] {
  const stripRejectedEdges = opts?.stripRejectedEdges === true;
  return components.map((row) => {
    if (stripRejectedEdges && row.status !== undefined && REJECTED_STATUSES.has(row.status)) {
      return { name: row.key, slots: [] };
    }
    const slotDefs = row.entry.$slots ?? {};
    const slots = Object.entries(slotDefs).map(([slotName, slotDef]) => ({
      name: slotName,
      allowedComponents: Array.isArray(slotDef?.$allowedComponents)
        ? (slotDef.$allowedComponents as unknown[]).filter((v): v is string => typeof v === 'string')
        : [],
    }));
    return { name: row.key, slots };
  });
}
