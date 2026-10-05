import { describe, expect, it, vi } from 'vitest';
import {
  runSelectionPipeline,
  type DebateTranscript,
  type FactualResolution,
  type SelectionPipelineComponent,
} from '../src/selection-pipeline.js';
import type { TieredSelectionDisagreement } from '../src/selection-diff.js';

const components: SelectionPipelineComponent[] = [
  { name: 'Card', source: '/components/Card.tsx', framework: 'react', props: [], slots: [] },
];

describe('selection escalation pipeline', () => {
  it('broadcasts every component to every agent and debates interpretive disagreements only', async () => {
    const broadcast = vi.fn(
      async (component: SelectionPipelineComponent, agentIndex: number) =>
        ({
          componentKey: `${component.name}::${component.source}`,
          decision: agentIndex === 0 ? 'accepted' : 'rejected',
          reason: agentIndex === 0 ? 'renders visible UI' : 'wrapper judgment',
        }) as const,
    );
    const verifyFactual = vi.fn(async (): Promise<FactualResolution> => ({ disagreementId: 'unused' }));
    const debateInterpretive = vi.fn(
      async (disagreement: TieredSelectionDisagreement): Promise<DebateTranscript> => ({
        disagreementId: disagreement.id,
        outcome: 'accepted',
      }),
    );

    const result = await runSelectionPipeline({
      components,
      agentCount: 2,
      broadcast,
      verifyFactual,
      debateInterpretive,
    });

    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(result.broadcast).toHaveLength(2);
    expect(result.tieredDisagreements[0].tier).toBe('interpretive');
    expect(verifyFactual).not.toHaveBeenCalled();
    expect(debateInterpretive).toHaveBeenCalledTimes(1);
    expect(result.debateTranscripts).toEqual([{ disagreementId: 'd1', outcome: 'accepted' }]);
  });

  it('resolves factual disagreements without dispatching debate', async () => {
    const verifyFactual = vi.fn(
      async (disagreement: TieredSelectionDisagreement): Promise<FactualResolution> => ({
        disagreementId: disagreement.id,
        value: 'verified',
      }),
    );
    const debateInterpretive = vi.fn(async (): Promise<DebateTranscript> => ({ disagreementId: 'unused' }));

    const result = await runSelectionPipeline({
      components,
      agentCount: 2,
      broadcast: async (component, agentIndex) => ({
        componentKey: `${component.name}::${component.source}`,
        decision: 'accepted',
        reason: 'same selection',
        facts: { description: agentIndex === 0 ? 'A card' : 'A panel' },
      }),
      verifyFactual,
      debateInterpretive,
    });

    expect(result.tieredDisagreements[0].tier).toBe('factual');
    expect(verifyFactual).toHaveBeenCalledTimes(1);
    expect(debateInterpretive).not.toHaveBeenCalled();
    expect(result.factualResolutions).toEqual([{ disagreementId: 'd1', value: 'verified' }]);
  });

  it('routes factual and interpretive disagreements independently in one run', async () => {
    const mixedComponents: SelectionPipelineComponent[] = [
      ...components,
      { name: 'Button', source: '/components/Button.tsx', framework: 'react', props: [], slots: [] },
    ];
    const verifyFactual = vi.fn(
      async (disagreement: TieredSelectionDisagreement): Promise<FactualResolution> => ({
        disagreementId: disagreement.id,
        decision: 'accepted',
      }),
    );
    const debateInterpretive = vi.fn(
      async (disagreement: TieredSelectionDisagreement): Promise<DebateTranscript> => ({
        disagreementId: disagreement.id,
        decision: 'rejected',
      }),
    );

    const result = await runSelectionPipeline({
      components: mixedComponents,
      agentCount: 2,
      broadcast: async (component, agentIndex) => {
        if (component.name === 'Card') {
          return {
            componentKey: `${component.name}::${component.source}`,
            decision: agentIndex === 0 ? 'accepted' : 'rejected',
            reason: 'selection judgment',
          } as const;
        }

        return {
          componentKey: `${component.name}::${component.source}`,
          decision: 'accepted',
          reason: 'same selection',
          facts: { description: agentIndex === 0 ? 'A button' : 'A control' },
        } as const;
      },
      verifyFactual,
      debateInterpretive,
    });

    expect(result.broadcast.flat()).toHaveLength(4);
    expect(result.tieredDisagreements.map(({ tier }) => tier).sort()).toEqual(['factual', 'interpretive']);
    expect(verifyFactual).toHaveBeenCalledTimes(1);
    expect(debateInterpretive).toHaveBeenCalledTimes(1);
  });
});
