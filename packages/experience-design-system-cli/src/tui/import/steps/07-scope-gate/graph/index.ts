import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { isAiFlagged } from '../sidebar/ai-flag.js';
import type { ScopeComponent } from '../types.js';
import { computeAllClosures, type Closure, type ComponentGraphNode, type NodeStatus } from './composite-closure.js';
import { findSlotCycles, type SlotCycle } from './cycle-detection.js';
import {
  buildCycleUnits,
  collectReachableCycleUnits,
  computeCycleAwareAcceptCascade,
  computeCycleAwareRejectCascade,
} from './scope-gate-cascade.js';
import { buildComponentGraph } from './slot-graph.js';

// Ported from legacy `analyze/`: slot-graph, composite-closure, cycle-detection, scope-gate-cascade, fuzzy-search and
// search-neighborhood, with their tests. backend-pipeline has different shapes of some of these and none of the
// cascades, so this is a copy, not a rewire (noted in the PR for whoever does that).
//
// Everything the legacy step worked out with `useMemo` on every render, worked out once here.

export interface ScopeGraph {
  /** The slot dependency graph, one node per component. */
  nodes: ComponentGraphNode[];
  /** Every slot cycle. A graph that cannot be searched for cycles has none, as in legacy. */
  cycles: SlotCycle[];
  /** Names in at least one cycle. */
  cycleParticipants: Set<string>;
  /** For each cycle member, the whole set of members that has to be accepted or rejected with it. */
  cycleUnits: Map<string, Set<string>>;
  /** For each root, what it needs. A root with more than one node is a group. */
  closures: Map<string, Closure>;
}

export interface SidebarItem {
  key: string;
  entry: CDFComponentEntry;
  status: NodeStatus;
}

/** What the sidebar draws a row from: an entry standing in for the component (its slots are what matter), and its status. */
export function sidebarItems(components: ScopeComponent[]): SidebarItem[] {
  return components.map((c) => ({
    key: c.name,
    entry: toSidebarEntry(c),
    status: isAiFlagged(c) ? 'warning' : 'ok',
  }));
}

function toSidebarEntry(c: ScopeComponent): CDFComponentEntry {
  const $slots: NonNullable<CDFComponentEntry['$slots']> = {};
  for (const s of c.slots ?? []) $slots[s.name] = { $allowedComponents: s.allowedComponents };
  const entry: CDFComponentEntry = {
    $type: 'component',
    $properties: { __scopeGate: { $type: 'string', $category: 'content' } },
  };
  if (Object.keys($slots).length > 0) entry.$slots = $slots;
  return entry;
}

export function buildScopeGraph(components: ScopeComponent[]): ScopeGraph {
  const nodes = buildComponentGraph(sidebarItems(components));
  let cycles: SlotCycle[];
  try {
    cycles = findSlotCycles(nodes);
  } catch {
    cycles = [];
  }
  const cycleParticipants = new Set<string>();
  for (const cycle of cycles) for (const name of cycle.path) cycleParticipants.add(name);
  return {
    nodes,
    cycles,
    cycleParticipants,
    cycleUnits: buildCycleUnits(cycles),
    closures: computeAllClosures(nodes),
  };
}

/** Names that change when `target` is accepted. Pulls in everything it needs, whole cycles together. */
export function acceptCascade(graph: ScopeGraph, target: string): string[] {
  return [...computeCycleAwareAcceptCascade(target, graph.nodes, graph.cycleUnits)];
}

/** Rejecting rejects every ancestor and deselects the descendants. The screen asks first when it is 2 or more. */
export function rejectCascade(graph: ScopeGraph, target: string): { toReject: string[]; toDeselect: string[] } {
  const { toReject, toDeselect } = computeCycleAwareRejectCascade(target, graph.nodes, graph.cycleUnits);
  return { toReject: [...toReject], toDeselect: [...toDeselect] };
}

/** Everything reachable from the seeds, including the cycles they depend on. Used by "toggle all" and "accept non-flagged". */
export function reachableCycleMembers(graph: ScopeGraph, seeds: string[]): string[] {
  return [...collectReachableCycleUnits(seeds, graph.nodes, graph.cycleUnits)];
}
