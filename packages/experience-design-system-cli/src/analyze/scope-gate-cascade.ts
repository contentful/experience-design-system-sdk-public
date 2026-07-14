import type { ComponentGraphNode } from './composite-closure.js';
import type { SlotCycle } from './cycle-detection.js';
import { findDirectParents } from './lineage.js';

export function buildCycleUnits(slotCycles: SlotCycle[]): Map<string, Set<string>> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) {
      cur = parent.get(cur)!;
    }
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

export interface CycleAwareRejectResult {
  toReject: Set<string>;
  toDeselect: Set<string>;
  cyclePartners: string[];
}

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
