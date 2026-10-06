import { describe, expect, it } from 'vitest';
import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import { createCliV2Api } from '../src/api/api.js';

function component(name: string): RawComponentDefinition {
  return {
    name,
    source: `/fixtures/${name}.tsx`,
    framework: 'react',
    props: [],
    slots: [],
  };
}

describe('cli-v2 resource API', () => {
  it('selects components and keeps reviews in the API session', async () => {
    const api = createCliV2Api({
      selectComponent: async (input) => ({
        decision: input.name === 'RejectMe' ? 'rejected' : 'accepted',
        reason: `classified ${input.name}`,
        confidence: 4,
      }),
    });

    const result = await api.selectComponents({ components: [component('KeepMe'), component('RejectMe')] });
    const accepted = result.reviews[0];

    expect(accepted).toMatchObject({
      component: { name: 'KeepMe' },
      decision: 'accepted',
      status: 'decided',
    });
    expect(await api.getComponentReview(accepted.id)).toEqual(accepted);
  });

  it('updates a review without writing shared storage', async () => {
    const api = createCliV2Api({
      selectComponent: async () => ({ decision: 'accepted', reason: 'initial decision' }),
    });
    const [{ id }] = (await api.selectComponents({ components: [component('Card')] })).reviews;

    const updated = await api.submitReviewDecision(id, {
      decision: 'rejected',
      reason: 'human review rejected the component',
    });

    expect(updated).toMatchObject({ id, decision: 'rejected', reason: 'human review rejected the component' });
    expect(await api.getComponentReview(id)).toEqual(updated);
  });

  it('rejects unknown review IDs', async () => {
    const api = createCliV2Api({
      selectComponent: async () => ({ decision: 'accepted', reason: 'initial decision' }),
    });

    await expect(api.submitReviewDecision('missing', { decision: 'accepted' })).rejects.toThrow(
      'Component review not found: missing',
    );
  });

  it('keeps review IDs in request order and returns isolated snapshots', async () => {
    const api = createCliV2Api({
      selectComponent: async (input) => {
        if (input.name === 'Slow') await new Promise((resolve) => setTimeout(resolve, 10));
        return { decision: 'accepted', reason: `classified ${input.name}` };
      },
    });

    const result = await api.selectComponents({ components: [component('Slow'), component('Fast')] });

    expect(result.reviews.map(({ id, component: selected }) => [id, selected.name])).toEqual([
      ['review-0', 'Slow'],
      ['review-1', 'Fast'],
    ]);

    const returned = await api.getComponentReview('review-0');
    if (!returned) throw new Error('Expected review-0 to exist');
    returned.component.name = 'Mutated outside the API';

    expect((await api.getComponentReview('review-0'))?.component.name).toBe('Slow');
  });
});
