import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

import type { ComponentGraphNode } from './composite-closure.js';

/**
 * Row-shape accepted by {@link buildComponentGraph}.
 *
 * The builder is a shared plumbing seam consumed by ScopeGate, GenerateReview,
 * and GroupedSidebar (per ADR-0010 Part 3). Each of those callsites carries a
 * slightly different row shape today (`GroupedSidebarItem`, `CdfReviewEntry`,
 * scope-gate component rows) but every one of them exposes a `key` (component
 * name) plus a `CDFComponentEntry`. Extra fields on the row are ignored.
 *
 * `status` is optional. It is only consulted when the caller passes
 * `stripRejectedEdges: true` — see {@link BuildOptions.stripRejectedEdges}.
 */
export interface SlotGraphInput {
  /** Component name — becomes {@link ComponentGraphNode.name}. */
  key: string;
  /** CDF definition — `$slots` is the source of outgoing edges. */
  entry: CDFComponentEntry;
  /**
   * Optional classifier. When {@link BuildOptions.stripRejectedEdges} is true,
   * rows whose status is exactly `'error'` (GroupedSidebar `NodeStatus`) or
   * `'rejected'` (review status) contribute no outgoing edges.
   */
  status?: string;
}

export interface BuildOptions {
  /**
   * When `true`, rows whose {@link SlotGraphInput.status} is `'error'` or
   * `'rejected'` contribute no outgoing edges to the graph — they show up as
   * `{ name, slots: [] }` nodes so the row still participates in tier layout
   * but its former slot targets are promoted back to standalones.
   *
   * When `false` or omitted, every row's `entry.$slots.$allowedComponents`
   * become edges regardless of status. This is the ScopeGate default:
   * "rejected" there means "excluded from generation scope," and cyclic
   * components are still worth showing to cycle detection.
   *
   * See ADR-0010 Part 3 and plan §4.1.
   */
  stripRejectedEdges?: boolean;
}

const REJECTED_STATUSES = new Set<string>(['error', 'rejected']);

/**
 * Build the canonical {@link ComponentGraphNode} array consumed by
 * `computeAllClosures`, `findSlotCycles`, and the sidebar tier walk.
 *
 * Pure function: no side effects, no mutation of the inputs. Ignores extra
 * properties on the row so callers can pass their existing item types
 * verbatim.
 *
 * Cycle detection is NOT this function's job — it simply enumerates the edges
 * declared in `$slots.$allowedComponents`. Callers hand the result to
 * `findSlotCycles` (or another consumer) when they want cycle information.
 */
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
