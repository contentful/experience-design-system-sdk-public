import { acceptCascade, rejectCascade, reachableCycleMembers, type ScopeGraph } from './graph/index.js';
import { isAiFlagged } from './sidebar/ai-flag.js';
import type { Decision, ScopeComponent, ScopeDecisions } from './types.js';

// The decisions the user has made, as a pure reducer. The component with the same name shares one decision.
// Everything that used to be inline `useState` handlers in ScopeGateStep.

export type DecisionState = Map<string, Decision>;

export type DecisionAction =
  | { type: 'accept'; name: string }
  | { type: 'reject'; name: string }
  | { type: 'toggle-all' }
  | { type: 'accept-unflagged' };

function apply(state: DecisionState, entries: Iterable<[string, Decision]>): DecisionState {
  const next = new Map(state);
  for (const [name, decision] of entries) next.set(name, decision);
  return next;
}

export function reduceDecisions(
  state: DecisionState,
  action: DecisionAction,
  components: ScopeComponent[],
  graph: ScopeGraph,
): DecisionState {
  switch (action.type) {
    case 'accept': {
      if (state.get(action.name) === 'accepted') return state;
      return apply(
        state,
        acceptCascade(graph, action.name).map((name): [string, Decision] => [name, 'accepted']),
      );
    }
    case 'reject': {
      if (state.get(action.name) === 'rejected') return state;
      const { toReject, toDeselect } = rejectCascade(graph, action.name);
      return apply(state, [
        ...toReject.map((name): [string, Decision] => [name, 'rejected']),
        ...toDeselect.map((name): [string, Decision] => [name, 'undecided']),
      ]);
    }
    case 'toggle-all': {
      const nonCycle = components.filter((c) => !graph.cycleParticipants.has(c.name)).map((c) => c.name);
      const anyNotAccepted = nonCycle.some((name) => state.get(name) !== 'accepted');
      if (anyNotAccepted) {
        return apply(state, [
          ...nonCycle.map((name): [string, Decision] => [name, 'accepted']),
          ...reachableCycleMembers(graph, nonCycle).map((name): [string, Decision] => [name, 'accepted']),
        ]);
      }
      return apply(state, [
        ...nonCycle.map((name): [string, Decision] => [name, 'rejected']),
        ...components
          .filter((c) => graph.cycleParticipants.has(c.name) && state.get(c.name) === 'accepted')
          .map((c): [string, Decision] => [c.name, 'undecided']),
      ]);
    }
    case 'accept-unflagged': {
      const seeds = components
        .filter((c) => !graph.cycleParticipants.has(c.name) && !isAiFlagged(c))
        .map((c) => c.name);
      return apply(state, [
        ...seeds.map((name): [string, Decision] => [name, 'accepted']),
        ...reachableCycleMembers(graph, seeds).map((name): [string, Decision] => [name, 'accepted']),
      ]);
    }
  }
}

/** Whether rejecting `name` touches 2 or more other components, so the screen has to ask first. */
export function rejectNeedsConfirmation(graph: ScopeGraph, name: string, state: DecisionState): boolean {
  if (state.get(name) === 'rejected') return false;
  const { toReject, toDeselect } = rejectCascade(graph, name);
  const ancestors = toReject.filter((n) => n !== name);
  return ancestors.length + toDeselect.length >= 2;
}

/** Everything not accepted counts as rejected, as legacy's `partition` did. */
export function partitionDecisions(components: ScopeComponent[], state: DecisionState): ScopeDecisions {
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const c of components) {
    if (state.get(c.name) === 'accepted') accepted.push(c.name);
    else rejected.push(c.name);
  }
  return { accepted, rejected };
}
