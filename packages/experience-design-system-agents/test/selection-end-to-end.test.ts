import { describe, expect, it, vi } from 'vitest';
import { assembleSelection, buildSelectionReview, determineSelection } from '../src/selection-orchestrator.js';
import {
  runSelectionPipeline,
  type DebateTranscript,
  type FactualResolution,
  type SelectionPipelineComponent,
} from '../src/selection-pipeline.js';
import type { SelectionResult, TieredSelectionDisagreement } from '../src/selection-diff.js';

const components: SelectionPipelineComponent[] = [
  { name: 'Card', source: 'src/Card.tsx', framework: 'react', props: [], slots: [] },
  { name: 'Button', source: 'src/Button.tsx', framework: 'react', props: [], slots: [] },
];

describe('selection pipeline end to end', () => {
  it('resolves factual and interpretive disagreements through assembly and review', async () => {
    const broadcast = vi.fn(
      async (component: SelectionPipelineComponent, agentIndex: number): Promise<SelectionResult> => {
        const componentKey = `${component.name}::${component.source}`;
        if (component.name === 'Card') {
          return {
            componentKey,
            decision: agentIndex === 0 ? 'accepted' : 'rejected',
            reason: agentIndex === 0 ? 'renders visible UI' : 'delegates to a renderer',
          };
        }

        return {
          componentKey,
          decision: 'accepted',
          reason: 'renders visible UI',
          facts: { description: agentIndex === 0 ? 'A primary action' : 'A button control' },
        };
      },
    );
    const verifyFactual = vi.fn(
      async (disagreement: TieredSelectionDisagreement): Promise<FactualResolution> => ({
        disagreementId: disagreement.id,
        decision: 'accepted',
        reason: 'Source evidence confirms the button is author-facing UI.',
      }),
    );
    const debateInterpretive = vi.fn(
      async (disagreement: TieredSelectionDisagreement): Promise<DebateTranscript> => ({
        disagreementId: disagreement.id,
        decision: 'rejected',
        reason: 'The card delegates its rendering responsibility to another component.',
        for: {
          role: 'for',
          disagreementId: disagreement.id,
          argument: 'The card has a visible author-facing surface.',
          evidence: [{ source: 'src/Card.tsx', line: '18', quote: 'return <CardView />' }],
        },
        against: {
          role: 'against',
          disagreementId: disagreement.id,
          argument: 'The sibling renderer owns the actual UI surface.',
          evidence: [{ source: 'src/Card.tsx', line: '18', quote: 'return <CardView />' }],
        },
      }),
    );

    const pipeline = await runSelectionPipeline({
      components,
      agentCount: 2,
      broadcast,
      verifyFactual,
      debateInterpretive,
    });
    const determinations = determineSelection(pipeline);
    const assembly = assembleSelection(pipeline.diff, determinations);
    const review = buildSelectionReview(pipeline.tieredDisagreements, determinations, pipeline.debateTranscripts);

    expect(broadcast).toHaveBeenCalledTimes(4);
    expect(pipeline.tieredDisagreements.map(({ tier }) => tier).sort()).toEqual(['factual', 'interpretive']);
    expect(verifyFactual).toHaveBeenCalledTimes(1);
    expect(debateInterpretive).toHaveBeenCalledTimes(1);
    expect(verifyFactual.mock.calls[0]?.[0].tier).toBe('factual');
    expect(debateInterpretive.mock.calls[0]?.[0].tier).toBe('interpretive');
    expect(assembly).toEqual({
      selections: [
        {
          componentKey: 'Button::src/Button.tsx',
          decision: 'accepted',
          reason: 'All participating agents agreed.',
          source: 'consensus',
        },
        {
          componentKey: 'Card::src/Card.tsx',
          decision: 'rejected',
          reason: 'The card delegates its rendering responsibility to another component.',
          source: 'debate',
        },
      ],
      report: { unresolvedCount: 0, unresolved: [], buildWarnings: [] },
    });
    expect(review).toMatchObject([
      {
        componentKey: 'Button::src/Button.tsx',
        status: 'resolved',
        determination: { resolvedBy: 'factual-verification' },
      },
      {
        componentKey: 'Card::src/Card.tsx',
        status: 'resolved',
        determination: { resolvedBy: 'debate' },
        debate: { for: { argument: 'The card has a visible author-facing surface.' } },
      },
    ]);
  });
});
