import type { ComponentGraphNode } from './composite-closure.js';
import type { SlotCycle } from './cycle-detection.js';
import { findDirectParents } from './lineage.js';

/**
 * Scope-gate-only cycle-aware cascade helpers.
 *
 * Wraps the pure `selection-cascade` primitives with cycle-unit cohesion
 * semantics. The base helpers stop at cycle boundaries by design (their
 * downstream consumers depend on that). Scope-gate needs the opposite: an
 * `[a]` or `[r]` on a cycle-related component must keep every member of the
 * cycle unit in the same state at all times, otherwise the accepted manifest
 * would ship with a slot referencing a rejected target — a topo-sort
 * violation.
 *
 * A "cycle unit" is the equivalence class of components under the relation
 * "shares at least one cycle." Two overlapping cycles collapse into a single
 * unit because a shared node forces both cycles' membership sets to move
 * together.
 */

/** Build a cycle-unit map: every cycle member points to the union of every
 * cycle that touches it (transitively via shared nodes). Non-cycle components
 * are absent from the map. */
export function buildCycleUnits(slotCycles: SlotCycle[]): Map<string, Set<string>> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      cur = parent.get(cur)!;
    }
    // Path compression pass.
    let walk = x;
    while (parent.get(walk) !== cur) {
      const next = parent.get(walk)!;
      parent.set(walk, cur);
      walk = next;
    }
    return cur;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const cycle of slotCycles) {
    for (const node of cycle.path) {
      if (!parent.has(node)) parent.set(node, node);
    }
    // `path` has the first node duplicated at the end; union with path[0] is
    // enough to link every node in the cycle.
    for (let i = 1; i < cycle.path.length; i++) {
      union(cycle.path[0], cycle.path[i]);
    }
  }

  const groups = new Map<string, Set<string>>();
  for (const node of parent.keys()) {
    const root = find(node);
    let group = groups.get(root);
    if (!group) {
      group = new Set<string>();
      groups.set(root, group);
    }
    group.add(node);
  }

  const out = new Map<string, Set<string>>();
  for (const group of groups.values()) {
    for (const node of group) {
      out.set(node, group);
    }
  }
  return out;
}

/** Slot targets of `node` restricted to components known to the graph. */
function slotTargets(node: string, byName: Map<string, ComponentGraphNode>): string[] {
  const c = byName.get(node);
  if (!c) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slot of c.slots) {
    for (const target of slot.allowedComponents ?? []) {
      if (!byName.has(target)) continue;
      if (seen.has(target)) continue;
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}

/**
 * Cycle-aware accept cascade. Walks the full slot-target closure from
 * `target`, traversing INTO cycles rather than stopping at cycle boundaries.
 * When any cycle member is visited, every member of its cycle unit is
 * included and the walk continues from each member's slot targets. Idempotent.
 */
export function computeCycleAwareAcceptCascade(
  target: string,
  components: ComponentGraphNode[],
  cycleUnits: Map<string, Set<string>>,
): Set<string> {
  const byName = new Map(components.map((c) => [c.name, c]));
  const visited = new Set<string>();
  const queue: string[] = [];

  const enqueue = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    queue.push(name);
    // Cohesion: touching any cycle member pulls its whole unit along.
    const unit = cycleUnits.get(name);
    if (unit) {
      for (const member of unit) {
        if (!visited.has(member)) {
          visited.add(member);
          queue.push(member);
        }
      }
    }
  };

  enqueue(target);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of slotTargets(cur, byName)) {
      enqueue(next);
    }
  }
  return visited;
}

/**
 * Cycle-aware reject cascade result. `toReject` is the set that must flip to
 * `rejected`; `toDeselect` is the set that must flip to `undecided` (matches
 * the existing "reject-parent deselects-descendants" tri-state semantics).
 * The two sets are disjoint.
 */
export interface CycleAwareRejectResult {
  toReject: Set<string>;
  toDeselect: Set<string>;
  /** Members of the target's cycle unit other than target itself. Empty when
   * target is not a cycle participant. Surfaced for the confirm-prompt UI so
   * it can list "also reject cycle partners" separately from external
   * ancestors. */
  cyclePartners: string[];
}

/**
 * Cycle-aware reject cascade.
 *
 * - Target + its cycle unit (if any) flip to `rejected`.
 * - All ancestors that reference any rejected node flip to `rejected`; the
 *   walk pulls in any ancestor's full cycle unit (cohesion) and continues
 *   from every unit member.
 * - Non-cycle descendants that the target's accept-cascade would have pulled
 *   in flip to `undecided` (existing deselect-descendants behavior). Cycle
 *   descendants that are already in `toReject` are excluded from
 *   `toDeselect` — they don't get deselected, they get rejected.
 */
export function computeCycleAwareRejectCascade(
  target: string,
  components: ComponentGraphNode[],
  cycleUnits: Map<string, Set<string>>,
): CycleAwareRejectResult {
  const toReject = new Set<string>();

  const targetUnit = cycleUnits.get(target);
  const initialSeeds: string[] = targetUnit ? [...targetUnit] : [target];
  for (const seed of initialSeeds) toReject.add(seed);

  // Walk ancestors. Whenever a newly-added node happens to be a cycle
  // member, splice in its whole cycle unit and keep walking from each unit
  // member. Terminates because every add is idempotent against `toReject`.
  const stack: string[] = [...toReject];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const { parent } of findDirectParents(cur, components)) {
      if (toReject.has(parent)) continue;
      toReject.add(parent);
      stack.push(parent);
      const unit = cycleUnits.get(parent);
      if (unit) {
        for (const member of unit) {
          if (!toReject.has(member)) {
            toReject.add(member);
            stack.push(member);
          }
        }
      }
    }
  }

  // Deselect anything the accept-cascade of the target would have pulled in
  // that we're NOT rejecting. Matches current "reject-parent deselects
  // descendants" tri-state semantics — restricted to non-rejected descendants
  // and excluding the target/unit themselves.
  const acceptCascade = computeCycleAwareAcceptCascade(target, components, cycleUnits);
  const toDeselect = new Set<string>();
  for (const n of acceptCascade) {
    if (toReject.has(n)) continue;
    toDeselect.add(n);
  }

  const cyclePartners: string[] = [];
  if (targetUnit) {
    for (const m of targetUnit) {
      if (m !== target) cyclePartners.push(m);
    }
    cyclePartners.sort();
  }

  return { toReject, toDeselect, cyclePartners };
}

/**
 * Union of every cycle unit reachable via slot-target closure from any of
 * `seeds`. Used by [A] toggle-all and [Y] accept-non-flagged to satisfy
 * cycle-unit cohesion: if any accepted seed transitively slots a cycle
 * member, that cycle's whole unit must also be accepted (otherwise the
 * seed's slot references a non-accepted target).
 *
 * Cheaper than running the full accept-cascade per seed — only cycle-unit
 * membership is emitted; non-cycle descendants of the seeds are ignored
 * because they'll be handled separately by the caller's own bulk-accept.
 */
export function collectReachableCycleUnits(
  seeds: string[],
  components: ComponentGraphNode[],
  cycleUnits: Map<string, Set<string>>,
): Set<string> {
  const out = new Set<string>();
  if (cycleUnits.size === 0) return out;
  const byName = new Map(components.map((c) => [c.name, c]));
  const visited = new Set<string>();
  const queue: string[] = [...seeds];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const unit = cycleUnits.get(cur);
    if (unit) {
      for (const member of unit) {
        out.add(member);
        if (!visited.has(member)) queue.push(member);
      }
    }
    for (const next of slotTargets(cur, byName)) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return out;
}
