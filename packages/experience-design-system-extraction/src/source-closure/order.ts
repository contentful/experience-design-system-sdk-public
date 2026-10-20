import type { ClosureGraph, ClosureScc } from './types.js';
/** Iterative Tarjan traversal emits dependencies before their dependants. */
export function orderClosureSccs<Local>(graph: ClosureGraph<Local>): ClosureScc[] {
  const indexes = new Map<string, number>();
  const lows = new Map<string, number>();
  const active: string[] = [];
  const onStack = new Set<string>();
  const result: ClosureScc[] = [];
  type Frame = { id: string; targets: string[]; next: number };
  const frames: Frame[] = [];
  function enter(id: string): void {
    indexes.set(id, indexes.size);
    lows.set(id, indexes.get(id)!);
    active.push(id);
    onStack.add(id);
    frames.push({
      id,
      targets: [
        ...new Set(
          graph.nodes
            .get(id)!
            .edges.map((edge) => edge.target)
            .filter((target) => graph.nodes.has(target)),
        ),
      ].sort(),
      next: 0,
    });
  }
  for (const root of [...graph.nodes.keys()].sort()) {
    if (indexes.has(root)) continue;
    enter(root);
    while (frames.length) {
      const frame = frames.at(-1)!;
      const target = frame.targets[frame.next];
      if (target !== undefined) {
        frame.next += 1;
        if (!indexes.has(target)) {
          enter(target);
          continue;
        }
        if (onStack.has(target)) lows.set(frame.id, Math.min(lows.get(frame.id)!, indexes.get(target)!));
        continue;
      }
      frames.pop();
      if (lows.get(frame.id) === indexes.get(frame.id)) {
        const members: string[] = [];
        let member: string;
        do {
          member = active.pop()!;
          onStack.delete(member);
          members.push(member);
        } while (member !== frame.id);
        members.sort();
        result.push({
          members,
          cyclic: members.length > 1 || graph.nodes.get(frame.id)!.edges.some((edge) => edge.target === frame.id),
        });
      }
      const parent = frames.at(-1);
      if (parent) lows.set(parent.id, Math.min(lows.get(parent.id)!, lows.get(frame.id)!));
    }
  }
  return result;
}
