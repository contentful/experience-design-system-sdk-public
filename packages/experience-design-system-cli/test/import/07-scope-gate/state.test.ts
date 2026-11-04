import { describe, expect, it } from 'vitest';
import { buildScopeGraph, sidebarItems } from '../../../src/tui/import/steps/07-scope-gate/graph/index.js';
import {
  createDecisionState,
  partitionDecisions,
  rejectNeedsConfirmation,
  reduceDecisions,
  type DecisionState,
} from '../../../src/tui/import/steps/07-scope-gate/state.js';
import type { ScopeComponent } from '../../../src/tui/import/steps/07-scope-gate/types.js';

const component = (
  name: string,
  slots: Array<{ name: string; allowedComponents: string[] }> = [],
  extra: Partial<ScopeComponent> = {},
): ScopeComponent => ({
  name,
  componentId: name.toLowerCase(),
  aiDecision: null,
  aiReason: null,
  needsReview: false,
  slots,
  ...extra,
});

const none = (): DecisionState => new Map();
const slot = (...allowed: string[]) => [{ name: 'children', allowedComponents: allowed }];

describe('accepting', () => {
  it('accepts a component with nothing in its slots on its own', () => {
    const components = [component('Button'), component('Card')];
    const next = reduceDecisions(none(), { type: 'accept', name: 'Button' }, components, buildScopeGraph(components));
    expect(next.get('Button')).toBe('accepted');
    expect(next.has('Card')).toBe(false);
  });

  it('brings in what the component needs in its slots', () => {
    const components = [component('Card', slot('Button')), component('Button'), component('Other')];
    const next = reduceDecisions(none(), { type: 'accept', name: 'Card' }, components, buildScopeGraph(components));
    expect(next.get('Card')).toBe('accepted');
    expect(next.get('Button')).toBe('accepted');
    expect(next.has('Other')).toBe(false);
  });

  it('accepts a whole cycle together', () => {
    const components = [component('A', slot('B')), component('B', slot('A')), component('C')];
    const next = reduceDecisions(none(), { type: 'accept', name: 'A' }, components, buildScopeGraph(components));
    expect(next.get('A')).toBe('accepted');
    expect(next.get('B')).toBe('accepted');
  });

  it('promotes an accepted row without saved provenance to a direct choice', () => {
    const components = [component('Button')];
    const state: DecisionState = new Map([['Button', 'accepted']]);
    const next = reduceDecisions(state, { type: 'accept', name: 'Button' }, components, buildScopeGraph(components));
    expect(next.get('Button')).toBe('accepted');
    expect(next.acceptedProvenance?.get('Button')).toEqual({ kind: 'direct', roots: ['Button'] });
  });

  it('does not change the state it was given', () => {
    const components = [component('Button')];
    const state = none();
    reduceDecisions(state, { type: 'accept', name: 'Button' }, components, buildScopeGraph(components));
    expect(state.size).toBe(0);
  });

  it('promotes a closure-accepted component to a direct choice and retains live direct roots', () => {
    const components = [component('Page', slot('Button')), component('Button')];
    const graph = buildScopeGraph(components);
    const fromPage = reduceDecisions(none(), { type: 'accept', name: 'Page' }, components, graph);
    expect(fromPage.acceptedProvenance?.get('Button')).toEqual({ kind: 'closure', roots: ['Page'] });

    const promoted = reduceDecisions(fromPage, { type: 'accept', name: 'Button' }, components, graph);
    const decisions = partitionDecisions(components, promoted);
    expect(decisions.acceptedProvenance).toEqual({
      Button: { kind: 'direct', roots: ['Button', 'Page'] },
      Page: { kind: 'direct', roots: ['Page'] },
    });
    expect(createDecisionState(components, decisions).acceptedProvenance).toEqual(promoted.acceptedProvenance);
  });

  it('marks only explicit cycle choices direct', () => {
    const components = [component('X', slot('Y')), component('Y', slot('X'))];
    const graph = buildScopeGraph(components);
    const first = reduceDecisions(none(), { type: 'accept', name: 'X' }, components, graph);
    expect(first.acceptedProvenance?.get('X')).toEqual({ kind: 'direct', roots: ['X'] });
    expect(first.acceptedProvenance?.get('Y')).toEqual({ kind: 'closure', roots: ['X'] });

    const second = reduceDecisions(first, { type: 'accept', name: 'Y' }, components, graph);
    expect(second.acceptedProvenance?.get('Y')).toEqual({ kind: 'direct', roots: ['X', 'Y'] });
  });
});

describe('rejecting', () => {
  it('rejects the ancestors that need it and deselects what only it needed', () => {
    const components = [component('Card', slot('Button')), component('Button')];
    const graph = buildScopeGraph(components);
    const accepted = reduceDecisions(none(), { type: 'accept', name: 'Card' }, components, graph);
    const next = reduceDecisions(accepted, { type: 'reject', name: 'Button' }, components, graph);
    expect(next.get('Button')).toBe('rejected');
    expect(next.get('Card')).toBe('rejected');
  });

  it('leaves the state alone when it is already rejected', () => {
    const components = [component('Button')];
    const state: DecisionState = new Map([['Button', 'rejected']]);
    expect(reduceDecisions(state, { type: 'reject', name: 'Button' }, components, buildScopeGraph(components))).toBe(
      state,
    );
  });
});

describe('rejectNeedsConfirmation', () => {
  it('does not ask for a component nothing depends on', () => {
    const components = [component('Button'), component('Card')];
    expect(rejectNeedsConfirmation(buildScopeGraph(components), 'Button', none())).toBe(false);
  });

  it('does not ask when only one other component is affected', () => {
    const components = [component('Card', slot('Button')), component('Button')];
    expect(rejectNeedsConfirmation(buildScopeGraph(components), 'Button', none())).toBe(false);
  });

  it('asks when two or more other components are affected', () => {
    const components = [component('Page', slot('Card')), component('Card', slot('Button')), component('Button')];
    expect(rejectNeedsConfirmation(buildScopeGraph(components), 'Button', none())).toBe(true);
  });

  it('does not ask when it is already rejected', () => {
    const components = [component('Page', slot('Card')), component('Card', slot('Button')), component('Button')];
    const state: DecisionState = new Map([['Button', 'rejected']]);
    expect(rejectNeedsConfirmation(buildScopeGraph(components), 'Button', state)).toBe(false);
  });
});

describe('toggle all', () => {
  const components = [component('A'), component('B'), component('X', slot('Y')), component('Y', slot('X'))];

  it('accepts everything outside a cycle, and the cycles they depend on', () => {
    const withCycleUser = [...components, component('Uses', slot('X'))];
    const next = reduceDecisions(none(), { type: 'toggle-all' }, withCycleUser, buildScopeGraph(withCycleUser));
    expect(next.get('A')).toBe('accepted');
    expect(next.get('B')).toBe('accepted');
    expect(next.get('Uses')).toBe('accepted');
    expect(next.get('X')).toBe('accepted');
    expect(next.get('Y')).toBe('accepted');
  });

  it('leaves cycles alone when nothing outside them depends on them', () => {
    const next = reduceDecisions(none(), { type: 'toggle-all' }, components, buildScopeGraph(components));
    expect(next.get('A')).toBe('accepted');
    expect(next.has('X')).toBe(false);
  });

  it('rejects everything outside a cycle once they are all accepted, and deselects accepted cycle members', () => {
    const graph = buildScopeGraph(components);
    const state: DecisionState = new Map([
      ['A', 'accepted'],
      ['B', 'accepted'],
      ['X', 'accepted'],
      ['Y', 'accepted'],
    ]);
    const next = reduceDecisions(state, { type: 'toggle-all' }, components, graph);
    expect(next.get('A')).toBe('rejected');
    expect(next.get('B')).toBe('rejected');
    expect(next.get('X')).toBe('undecided');
    expect(next.get('Y')).toBe('undecided');
  });
});

describe('accept non-flagged', () => {
  it('includes extraction review candidates unless the AI rejected or failed them', () => {
    const components = [
      component('Accepted', [], { aiDecision: 'accepted', needsReview: true }),
      component('Pending', [], { aiDecision: null, needsReview: true }),
      component('Rejected', [], { aiDecision: 'rejected', needsReview: true }),
      component('Failed', [], { aiDecision: 'failed', needsReview: false }),
    ];
    const graph = buildScopeGraph(components);

    expect(sidebarItems(components).map(({ key, status }) => ({ name: key, status }))).toEqual([
      { name: 'Accepted', status: 'ok' },
      { name: 'Pending', status: 'ok' },
      { name: 'Rejected', status: 'warning' },
      { name: 'Failed', status: 'warning' },
    ]);
    const next = reduceDecisions(none(), { type: 'accept-unflagged' }, components, graph);
    expect([...next]).toEqual([
      ['Accepted', 'accepted'],
      ['Pending', 'accepted'],
    ]);
  });

  it('accepts the components the AI did not flag', () => {
    const components = [
      component('Good'),
      component('Flagged', [], { aiDecision: 'rejected', aiReason: 'internal helper' }),
    ];
    const next = reduceDecisions(none(), { type: 'accept-unflagged' }, components, buildScopeGraph(components));
    expect(next.get('Good')).toBe('accepted');
    expect(next.has('Flagged')).toBe(false);
  });
});

describe('partitionDecisions', () => {
  it('retains direct provenance for prototype-like component names in serialized partitions', () => {
    const components = [component('__proto__'), component('constructor')];
    const graph = buildScopeGraph(components);
    let state = none();
    for (const name of ['__proto__', 'constructor']) {
      state = reduceDecisions(state, { type: 'accept', name }, components, graph);
    }
    const serialized = JSON.parse(JSON.stringify(partitionDecisions(components, state)));
    expect(Object.hasOwn(serialized.acceptedProvenance, '__proto__')).toBe(true);
    expect(serialized.acceptedProvenance.__proto__).toEqual({ kind: 'direct', roots: ['__proto__'] });
    expect(serialized.acceptedProvenance.constructor).toEqual({ kind: 'direct', roots: ['constructor'] });
  });

  it('counts everything that is not accepted as rejected', () => {
    const components = [component('A'), component('B'), component('C')];
    const state: DecisionState = new Map([
      ['A', 'accepted'],
      ['B', 'undecided'],
    ]);
    expect(partitionDecisions(components, state)).toEqual({
      accepted: ['A'],
      rejected: ['B', 'C'],
      acceptedProvenance: { A: { kind: 'unknown', roots: [] } },
    });
  });
});
