import { closureValueEqual } from './evidence.js';
import { orderClosureSccs } from './order.js';
import type { ClosureAdapter, ClosureGraph, ClosureSummary } from './types.js';
export class ClosureConvergenceError extends Error {
  constructor(
    readonly members: readonly string[],
    readonly maxIterations: number,
  ) {
    super(`Closure cycle did not converge after ${maxIterations} iterations`);
    this.name = 'ClosureConvergenceError';
  }
}
export function computeClosureSummaries<Local>(
  graph: ClosureGraph<Local>,
  adapter: ClosureAdapter<Local>,
  options: { maxIterations?: number; signal?: AbortSignal } = {},
): ReadonlyMap<string, ClosureSummary> {
  const maxIterations = options.maxIterations ?? 1000;
  if (!Number.isSafeInteger(maxIterations) || maxIterations <= 0)
    throw new RangeError('Closure iteration bound must be a positive safe integer');
  const summaries = new Map<string, ClosureSummary>();
  const get = (id: string) => summaries.get(id);
  function transfer(id: string): ClosureSummary {
    options.signal?.throwIfAborted();
    const value = adapter.transfer(graph.nodes.get(id)!, get);
    closureValueEqual(value, value);
    return value;
  }
  for (const group of orderClosureSccs(graph)) {
    if (!group.cyclic) {
      const id = group.members[0]!;
      summaries.set(id, transfer(id));
      continue;
    }
    for (const id of group.members) summaries.set(id, adapter.bottom(graph.nodes.get(id)!));
    let converged = false;
    for (let pass = 0; pass < maxIterations; pass += 1) {
      let changed = false;
      for (const id of group.members) {
        const next = transfer(id);
        if (!closureValueEqual(summaries.get(id), next)) changed = true;
        summaries.set(id, next);
      }
      if (!changed) {
        converged = true;
        break;
      }
    }
    if (!converged) throw new ClosureConvergenceError(group.members, maxIterations);
  }
  return new Map([...summaries].sort(([a], [b]) => a.localeCompare(b)));
}
