import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExistingContentfulEntities } from '../../../src/steps/generation/src/types/existing-entities.js';

const agent = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock('../../../src/agents/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/agents/index.js')>();
  return {
    ...actual,
    createLocalCliAgentInvoker: () => ({
      invoke: async ({ prompt }: { prompt: string }) => {
        agent.prompts.push(prompt);
        return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
      },
    }),
  };
});

import { selectComponents } from '../../../src/steps/selection/src/controller/select-components-endpoint.js';

const request = () => ({
  components: [{ name: 'Card', source: 'Card.ts', framework: 'react' as const, props: [], slots: [] }],
  agent: 'claude',
  promptText: 'Literal custom selection instructions',
});

describe('selection controller optional context', () => {
  beforeEach(() => {
    agent.prompts.length = 0;
  });

  it('preserves exact supplied summaries and override text through the controller and service', async () => {
    await selectComponents({
      ...request(),
      existingComponentsInline: ' literal component summary ',
      existingTokensInline: ' literal token summary ',
    } as Parameters<typeof selectComponents>[0]);
    expect(agent.prompts[0]).toContain(' literal component summary ');
    expect(agent.prompts[0]).toContain(' literal token summary ');
    expect(agent.prompts[0]).toContain('Literal custom selection instructions');
  });

  it('summarizes supplied model objects without fetching and preserves literal-summary precedence', async () => {
    const existingContentfulEntities = {
      components: [{ sys: { id: 'example-component' }, name: 'Example model', description: 'Optional alignment' }],
      tokens: [],
    } as unknown as ExistingContentfulEntities;
    await selectComponents({ ...request(), existingContentfulEntities } as Parameters<typeof selectComponents>[0]);
    expect(agent.prompts[0]).toContain('Example model');
    await selectComponents({
      ...request(),
      existingContentfulEntities,
      existingComponentsInline: 'Literal takes precedence',
    } as Parameters<typeof selectComponents>[0]);
    expect(agent.prompts[1]).toContain('Literal takes precedence');
    expect(agent.prompts[1]).not.toContain('Example model');
  });

  it.each([undefined, null])('keeps absent optional models advisory: %s', async (existingContentfulEntities) => {
    await selectComponents({ ...request(), existingContentfulEntities } as Parameters<typeof selectComponents>[0]);
    expect(agent.prompts[0]).not.toContain('Existing components in the target');
    expect(agent.prompts[0]).toContain('Card');
  });
});
