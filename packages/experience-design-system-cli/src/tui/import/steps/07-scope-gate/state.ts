import { acceptCascade, rejectCascade, reachableCycleMembers, type ScopeGraph } from './graph/index.js';
import { isAiFlagged } from './sidebar/ai-flag.js';
import type { Decision, ScopeComponent, ScopeDecisions, ScopeProvenance } from './types.js';

// Statuses and direct-root provenance share one reducer value so cascade updates cannot leave stale causes behind.
export type DecisionState = Map<string, Decision> & { acceptedProvenance?: Map<string, ScopeProvenance> };

export type DecisionAction =
  | { type: 'accept'; name: string }
  | { type: 'reject'; name: string }
  | { type: 'toggle-all' }
  | { type: 'accept-unflagged' };

const unknown: ScopeProvenance = { kind: 'unknown', roots: [] };

function copyState(state: DecisionState): DecisionState {
  const next = new Map(state) as DecisionState;
  next.acceptedProvenance = new Map(state.acceptedProvenance ?? []);
  return next;
}

function apply(state: DecisionState, entries: Iterable<[string, Decision]>): DecisionState {
  const next = copyState(state);
  for (const [name, decision] of entries) {
    next.set(name, decision);
    if (decision !== 'accepted') next.acceptedProvenance?.delete(name);
  }
  return next;
}

function refreshProvenance(state: DecisionState, graph: ScopeGraph): DecisionState {
  const roots = [...state.entries()]
    .filter(([name, decision]) => decision === 'accepted' && state.acceptedProvenance?.get(name)?.kind === 'direct')
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
  const reachability = new Map(roots.map((root) => [root, new Set(acceptCascade(graph, root))]));
  const next = copyState(state);
  const provenance = new Map<string, ScopeProvenance>();
  for (const [name, decision] of next) {
    if (decision !== 'accepted') continue;
    const liveRoots = roots.filter((root) => reachability.get(root)?.has(name));
    provenance.set(
      name,
      liveRoots.length === 0 ? unknown : { kind: liveRoots.includes(name) ? 'direct' : 'closure', roots: liveRoots },
    );
  }
  next.acceptedProvenance = provenance;
  return next;
}

export function createDecisionState(components: ScopeComponent[], saved?: ScopeDecisions): DecisionState {
  const accepted = new Set(saved?.accepted ?? []);
  const rejected = new Set(saved?.rejected ?? []);
  const state = new Map<string, Decision>() as DecisionState;
  state.acceptedProvenance = new Map();
  for (const component of components) {
    if (accepted.has(component.name)) {
      state.set(component.name, 'accepted');
      state.acceptedProvenance.set(component.name, saved?.acceptedProvenance?.[component.name] ?? unknown);
    } else if (rejected.has(component.name)) {
      state.set(component.name, 'rejected');
    }
  }
  return state;
}

export function reduceDecisions(
  state: DecisionState,
  action: DecisionAction,
  components: ScopeComponent[],
  graph: ScopeGraph,
): DecisionState {
  switch (action.type) {
    case 'accept': {
      if (state.get(action.name) === 'accepted' && state.acceptedProvenance?.get(action.name)?.kind === 'direct')
        return state;
      const next = apply(
        state,
        acceptCascade(graph, action.name).map((name): [string, Decision] => [name, 'accepted']),
      );
      next.acceptedProvenance?.set(action.name, { kind: 'direct', roots: [action.name] });
      return refreshProvenance(next, graph);
    }
    case 'reject': {
      if (state.get(action.name) === 'rejected') return state;
      const { toReject, toDeselect } = rejectCascade(graph, action.name);
      return refreshProvenance(
        apply(state, [
          ...toReject.map((name): [string, Decision] => [name, 'rejected']),
          ...toDeselect.map((name): [string, Decision] => [name, 'undecided']),
        ]),
        graph,
      );
    }
    case 'toggle-all': {
      const nonCycle = components
        .filter((component) => !graph.cycleParticipants.has(component.name))
        .map((component) => component.name);
      const anyNotAccepted = nonCycle.some((name) => state.get(name) !== 'accepted');
      if (anyNotAccepted) {
        const next = apply(state, [
          ...nonCycle.map((name): [string, Decision] => [name, 'accepted']),
          ...reachableCycleMembers(graph, nonCycle).map((name): [string, Decision] => [name, 'accepted']),
        ]);
        for (const name of nonCycle) next.acceptedProvenance?.set(name, { kind: 'direct', roots: [name] });
        return refreshProvenance(next, graph);
      }
      return refreshProvenance(
        apply(state, [
          ...nonCycle.map((name): [string, Decision] => [name, 'rejected']),
          ...components
            .filter(
              (component) => graph.cycleParticipants.has(component.name) && state.get(component.name) === 'accepted',
            )
            .map((component): [string, Decision] => [component.name, 'undecided']),
        ]),
        graph,
      );
    }
    case 'accept-unflagged': {
      const seeds = components
        .filter((component) => !graph.cycleParticipants.has(component.name) && !isAiFlagged(component))
        .map((component) => component.name);
      const next = apply(state, [
        ...seeds.map((name): [string, Decision] => [name, 'accepted']),
        ...reachableCycleMembers(graph, seeds).map((name): [string, Decision] => [name, 'accepted']),
      ]);
      for (const name of seeds) next.acceptedProvenance?.set(name, { kind: 'direct', roots: [name] });
      return refreshProvenance(next, graph);
    }
  }
}

/** Whether rejecting `name` touches 2 or more other components, so the screen has to ask first. */
export function rejectNeedsConfirmation(graph: ScopeGraph, name: string, state: DecisionState): boolean {
  if (state.get(name) === 'rejected') return false;
  const { toReject, toDeselect } = rejectCascade(graph, name);
  const ancestors = toReject.filter((componentName) => componentName !== name);
  return ancestors.length + toDeselect.length >= 2;
}

/** Everything not accepted counts as rejected, as legacy's `partition` did. */
export function partitionDecisions(components: ScopeComponent[], state: DecisionState): ScopeDecisions {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const acceptedProvenance = Object.create(null) as Record<string, ScopeProvenance>;
  for (const component of components) {
    if (state.get(component.name) === 'accepted') {
      accepted.push(component.name);
      acceptedProvenance[component.name] = state.acceptedProvenance?.get(component.name) ?? unknown;
    } else rejected.push(component.name);
  }
  return { accepted, rejected, acceptedProvenance };
}
