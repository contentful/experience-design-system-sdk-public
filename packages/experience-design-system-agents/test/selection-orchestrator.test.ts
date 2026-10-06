import { describe, expect, it } from 'vitest';
import { assembleSelection, buildSelectionReview, determineSelection } from '../src/selection-orchestrator.js';
import type { SelectionPipelineResult } from '../src/selection-pipeline.js';

const pipeline = {
  broadcast: [],
  diff: {
    consensus: [
      { componentKey: 'Button', decision: 'accepted', reason: 'visible UI', coverage: 2, providers: [0, 1] },
      { componentKey: 'Card', reason: 'visible UI', coverage: 2, providers: [0, 1] },
    ],
    disagreements: [
      {
        id: 'd1',
        componentKey: 'Card',
        field: 'decision',
        valuesByAgent: { 0: 'accepted', 1: 'rejected' },
        reasonsByAgent: { 0: 'visible UI', 1: 'wrapper' },
      },
    ],
  },
  tieredDisagreements: [
    {
      id: 'd1',
      componentKey: 'Card',
      field: 'decision',
      valuesByAgent: { 0: 'accepted', 1: 'rejected' },
      reasonsByAgent: { 0: 'visible UI', 1: 'wrapper' },
      tier: 'interpretive',
      tierReason: 'Requires judgment.',
    },
  ],
  factualResolutions: [],
  debateTranscripts: [
    {
      disagreementId: 'd1',
      decision: 'accepted',
      reason: 'Owns visible markup.',
      for: {
        role: 'for',
        disagreementId: 'd1',
        argument: 'The component renders authorable UI.',
        evidence: [{ source: 'src/Card.tsx', line: '12', quote: '<Card />' }],
      },
      against: {
        role: 'against',
        disagreementId: 'd1',
        argument: 'The component is only a wrapper.',
        evidence: [],
      },
    },
  ],
} satisfies SelectionPipelineResult;

describe('selection orchestrator', () => {
  it('determines each debate result independently and assembles it with consensus', () => {
    const determinations = determineSelection(pipeline);
    const assembled = assembleSelection(pipeline.diff, determinations);

    expect(assembled.selections).toEqual([
      { componentKey: 'Button', decision: 'accepted', reason: 'All participating agents agreed.', source: 'consensus' },
      { componentKey: 'Card', decision: 'accepted', reason: 'Owns visible markup.', source: 'debate' },
    ]);
    expect(assembled.report).toEqual({ unresolvedCount: 0, unresolved: [], buildWarnings: [] });
  });

  it('reports unresolved disagreements instead of guessing', () => {
    const assembled = assembleSelection(pipeline.diff, []);

    expect(assembled.selections).toHaveLength(1);
    expect(assembled.report).toEqual({
      unresolvedCount: 1,
      unresolved: ['Card'],
      buildWarnings: ['No complete determination exists for Card.'],
    });
  });

  it('projects pending and resolved items for a review surface', () => {
    expect(
      buildSelectionReview(pipeline.tieredDisagreements, determineSelection(pipeline), pipeline.debateTranscripts),
    ).toMatchObject([
      {
        id: 'd1',
        status: 'resolved',
        determination: { resolvedBy: 'debate' },
        debate: {
          for: { argument: 'The component renders authorable UI.' },
          against: { argument: 'The component is only a wrapper.' },
        },
      },
    ]);
  });
});
