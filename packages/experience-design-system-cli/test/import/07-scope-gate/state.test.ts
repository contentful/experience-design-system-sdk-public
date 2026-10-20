import { describe, expect, it } from 'vitest';
import { buildScopeGraph } from '../../../src/tui/import/steps/07-scope-gate/graph/index.js';
import {
  partitionDecisions,
  rejectNeedsConfirmation,
  reduceDecisions,
  withoutSlotChildren,
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

  it('leaves the state alone when it is already accepted', () => {
    const components = [component('Button')];
    const state: DecisionState = new Map([['Button', 'accepted']]);
    expect(reduceDecisions(state, { type: 'accept', name: 'Button' }, components, buildScopeGraph(components))).toBe(
      state,
    );
  });

  it('does not change the state it was given', () => {
    const components = [component('Button')];
    const state = none();
    reduceDecisions(state, { type: 'accept', name: 'Button' }, components, buildScopeGraph(components));
    expect(state.size).toBe(0);
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
  const state: DecisionState = new Map([
    ['A', 'accepted'],
    ['B', 'undecided'],
  ]);

  it('counts everything that is not accepted as rejected', () => {
    const components = [component('A'), component('B'), component('C')];
    expect(partitionDecisions(components, state, [])).toEqual({
      accepted: ['A'],
      rejected: ['B', 'C'],
      excludedSlotEdges: [],
    });
  });

  it('keeps a removed slot edge while both of its components are accepted', () => {
    const components = [component('A'), component('B')];
    const accepted: DecisionState = new Map([
      ['A', 'accepted'],
      ['B', 'accepted'],
    ]);
    const edge = { parent: 'A', child: 'B' };
    expect(partitionDecisions(components, accepted, [edge]).excludedSlotEdges).toEqual([edge]);
  });

  it.each([
    ['parent', { parent: 'B', child: 'A' }],
    ['child', { parent: 'A', child: 'B' }],
  ])('drops a removed slot edge whose %s is rejected', (_which, edge) => {
    const components = [component('A'), component('B')];
    expect(partitionDecisions(components, state, [edge]).excludedSlotEdges).toEqual([]);
  });
});

describe('withoutSlotChildren', () => {
  const components = [
    component('Flex', slot('Text', 'Button')),
    component('Card', slot('Text')),
    component('Text'),
    component('Button'),
  ];
  const slotsOf = (list: ScopeComponent[], name: string) => list.find((c) => c.name === name)?.slots;

  it('changes nothing when no edge was removed', () => {
    expect(withoutSlotChildren(components, [])).toEqual(components);
  });

  it('removes the child from that parent only, so the same child under another parent stays', () => {
    const next = withoutSlotChildren(components, [{ parent: 'Flex', child: 'Text' }]);
    expect(slotsOf(next, 'Flex')).toEqual(slot('Button'));
    expect(slotsOf(next, 'Card')).toEqual(slot('Text'));
  });

  it('keeps every component in the list and does not change the input', () => {
    const next = withoutSlotChildren(components, [{ parent: 'Flex', child: 'Text' }]);
    expect(next.map((c) => c.name)).toEqual(['Flex', 'Card', 'Text', 'Button']);
    expect(slotsOf(components, 'Flex')).toEqual(slot('Text', 'Button'));
  });

  it('removes the child from every slot of the parent', () => {
    const twoSlots = [
      component('Flex', [
        { name: 'start', allowedComponents: ['Text'] },
        { name: 'end', allowedComponents: ['Text', 'Button'] },
      ]),
    ];
    const next = withoutSlotChildren(twoSlots, [{ parent: 'Flex', child: 'Text' }]);
    expect(slotsOf(next, 'Flex')).toEqual([
      { name: 'start', allowedComponents: [] },
      { name: 'end', allowedComponents: ['Button'] },
    ]);
  });

  it('applies several removals', () => {
    const next = withoutSlotChildren(components, [
      { parent: 'Flex', child: 'Text' },
      { parent: 'Flex', child: 'Button' },
    ]);
    expect(slotsOf(next, 'Flex')).toEqual(slot());
  });
});
