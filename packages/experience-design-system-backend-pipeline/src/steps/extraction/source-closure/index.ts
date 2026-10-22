export { buildClosureGraph } from './graph.js';
export { orderClosureSccs } from './order.js';
export { computeClosureSummaries, ClosureConvergenceError } from './summaries.js';
export { deriveClosureFact, closureValueEqual } from './evidence.js';
export type {
  ClosureAdapter,
  ClosureEdge,
  ClosureEnd,
  ClosureFact,
  ClosureGraph,
  ClosureNode,
  ClosureProofStrength,
  ClosureScc,
  ClosureSummary,
} from './types.js';
