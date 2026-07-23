import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

import type { ComponentGraphNode } from './composite-closure.js';

export interface SlotGraphInput {
  key: string;
  entry: CDFComponentEntry;
  status?: string;
}

export interface BuildOptions {
  stripRejectedEdges?: boolean;
}

const REJECTED_STATUSES = new Set<string>(['error', 'rejected']);

export function buildComponentGraph(
  components: SlotGraphInput[],
  opts?: BuildOptions,
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
        ? (slotDef.$allowedComponents as unknown[]).filter(
            (v): v is string => typeof v === 'string',
          )
        : [],
    }));

    return { name: row.key, slots };
  });
}
