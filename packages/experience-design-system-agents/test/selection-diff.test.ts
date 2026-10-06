import { describe, expect, it } from 'vitest';
import { diffSelectionResults, tierSelectionDisagreements, type SelectionResult } from '../src/selection-diff.js';

const result = (componentKey: string, decision: SelectionResult['decision'], reason: string): SelectionResult => ({
  componentKey,
  decision,
  reason,
});

describe('selection diff and tiering', () => {
  it('produces consensus and a complete disagreement record', () => {
    const diff = diffSelectionResults([
      [result('Card', 'accepted', 'renders visible UI'), result('Hook', 'rejected', 'not renderable')],
      [result('Card', 'rejected', 'delegates to another renderer'), result('Hook', 'rejected', 'not renderable')],
      [result('Card', 'accepted', 'author-facing component')],
    ]);

    expect(diff.consensus).toEqual([
      { componentKey: 'Card', reason: 'renders visible UI', coverage: 3, providers: [0, 1, 2] },
      { componentKey: 'Hook', decision: 'rejected', reason: 'not renderable', coverage: 2, providers: [0, 1] },
    ]);
    expect(diff.disagreements).toEqual([
      {
        id: 'd1',
        componentKey: 'Card',
        field: 'decision',
        valuesByAgent: { 0: 'accepted', 1: 'rejected', 2: 'accepted' },
        reasonsByAgent: {
          0: 'renders visible UI',
          1: 'delegates to another renderer',
          2: 'author-facing component',
        },
      },
    ]);
  });

  it('tiers selection disagreements as interpretive with reasoning', () => {
    const disagreement = diffSelectionResults([
      [result('Card', 'accepted', 'visible UI')],
      [result('Card', 'rejected', 'wrapper')],
    ]).disagreements;

    expect(tierSelectionDisagreements(disagreement)).toMatchObject([
      {
        id: 'd1',
        tier: 'interpretive',
        tierReason: expect.stringContaining('judgment'),
      },
    ]);
  });

  it('does not mutate the agent result arrays', () => {
    const inputs = [[result('Card', 'accepted', 'visible UI')]];
    const snapshot = structuredClone(inputs);

    diffSelectionResults(inputs);

    expect(inputs).toEqual(snapshot);
  });

  it('keeps agreed selection evidence in the consensus baseline', () => {
    const diff = diffSelectionResults([
      [{ ...result('Card', 'accepted', 'first reason'), facts: { description: 'Card', allowed: ['Button', 'Link'] } }],
      [{ ...result('Card', 'accepted', 'second reason'), facts: { description: 'Card', allowed: ['Link', 'Button'] } }],
    ]);

    expect(diff.consensus).toEqual([
      {
        componentKey: 'Card',
        decision: 'accepted',
        reason: 'first reason',
        facts: { description: 'Card', allowed: ['Button', 'Link'] },
        coverage: 2,
        providers: [0, 1],
      },
    ]);
    expect(diff.disagreements).toEqual([]);
  });

  it('removes disputed evidence from consensus while retaining the disagreement record', () => {
    const diff = diffSelectionResults([
      [{ ...result('Card', 'accepted', 'first reason'), facts: { description: 'Card' } }],
      [{ ...result('Card', 'accepted', 'second reason'), facts: { description: 'Panel' } }],
    ]);

    expect(diff.consensus[0]).not.toHaveProperty('facts');
    expect(diff.disagreements).toMatchObject([{ field: 'description', valuesByAgent: { 0: 'Card', 1: 'Panel' } }]);
  });

  it('keeps factual disagreements eligible for direct verification', () => {
    const disagreement = {
      id: 'd1',
      componentKey: 'Card',
      field: 'description' as const,
      valuesByAgent: { 0: 'A card', 1: 'A panel' },
      reasonsByAgent: { 0: 'source text', 1: 'source text' },
    };

    expect(tierSelectionDisagreements([disagreement])).toMatchObject([
      { id: 'd1', tier: 'factual', tierReason: expect.stringContaining('verifiable') },
    ]);
  });

  it('treats DTCG description disagreements as factual', () => {
    const disagreement = {
      id: 'd1',
      componentKey: 'Card',
      field: '$description',
      valuesByAgent: { 0: 'A card', 1: 'A panel' },
      reasonsByAgent: { 0: 'source text', 1: 'source text' },
    };

    expect(tierSelectionDisagreements([disagreement])).toMatchObject([
      { id: 'd1', tier: 'factual', tierReason: expect.stringContaining('verifiable') },
    ]);
  });
});
