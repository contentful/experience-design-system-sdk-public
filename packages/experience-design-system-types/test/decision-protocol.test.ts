import { expect, it } from 'vitest';
import { normalizeClassificationCalls } from '../src/property-contract/decision-protocol.js';

it('names every unknown key on a rejected decision', () => {
  expect(
    normalizeClassificationCalls([{ tool: 'exclude_prop', prop: 'onClick', reason: 'Callback', why: 'x', note: 'y' }]),
  ).toEqual({ calls: [], warnings: ['decision 1: property:onClick: Unknown decision field: why, note'] });
});

it('accepts a decision whose keys all belong to its tool', () => {
  expect(normalizeClassificationCalls([{ tool: 'exclude_prop', prop: 'onClick', reason: 'Callback' }])).toEqual({
    calls: [{ tool: 'exclude_prop', prop: 'onClick', reason: 'Callback' }],
    warnings: [],
  });
});
